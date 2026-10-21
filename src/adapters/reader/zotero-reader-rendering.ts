import type { UntrustedContentRenderingPort } from "../../ports/rendering.js";
import { isSafeReferenceUrl } from "../rendering/safe-markdown-renderer.js";

const PREVIEW_ATTRIBUTE = "data-zotero-gpt-rendered-comment";
const PREVIEW_BODY_ATTRIBUTE = "data-zotero-gpt-rendered-body";
const TOGGLE_ATTRIBUTE = "data-zotero-gpt-toggle-source";
const COMMENT_MODE_ATTRIBUTE = "data-zotero-gpt-comment-mode";
const STYLE_ATTRIBUTE = "data-zotero-gpt-reader-style";
const PREVIEW_SELECTOR = `[${PREVIEW_ATTRIBUTE}]`;

interface ReaderStateLike {
  sidebarOpen?: unknown;
  sidebarView?: unknown;
  selectedAnnotationIDs?: unknown;
}

export interface ZoteroReaderLike {
  itemID?: number;
  _initPromise?: Promise<unknown>;
  _iframeWindow?: { document?: Document };
  _internalReader?: {
    _primaryView?: { initializedPromise?: Promise<unknown> };
    _state?: ReaderStateLike;
  };
}

export interface ZoteroReaderHostLike {
  Reader: { _readers: ZoteroReaderLike[] };
}

export interface VisiblePreviewRequest {
  attachmentItemId: number;
  annotationKey: string;
  expectedNativeComment: string;
}

export interface ZoteroReaderRenderingAdapterOptions {
  host: ZoteroReaderHostLike;
  renderer: UntrustedContentRenderingPort;
  openLink(url: string): void;
  scanIntervalMilliseconds?: number;
  setInterval?(handler: () => void, milliseconds: number): unknown;
  clearInterval?(handle: unknown): void;
  onError?(error: unknown): void;
}

interface AttachedReader {
  reader: ZoteroReaderLike;
  document: Document;
  observer: MutationObserver | undefined;
  clickHandler: (event: Event) => void;
  rendering: Promise<void>;
}

/**
 * Owns formatted preview nodes inside active Zotero readers. Native editor
 * nodes remain untouched and canonical throughout the adapter lifecycle.
 */
export class ZoteroReaderRenderingAdapter {
  readonly #host: ZoteroReaderHostLike;
  readonly #renderer: UntrustedContentRenderingPort;
  readonly #openLink: (url: string) => void;
  readonly #scanIntervalMilliseconds: number;
  readonly #setInterval: (handler: () => void, milliseconds: number) => unknown;
  readonly #clearInterval: (handle: unknown) => void;
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #attached = new Map<ZoteroReaderLike, AttachedReader>();
  #active = false;
  #interval: unknown;
  #syncing: Promise<void> = Promise.resolve();

  constructor(options: ZoteroReaderRenderingAdapterOptions) {
    this.#host = options.host;
    this.#renderer = options.renderer;
    this.#openLink = options.openLink;
    this.#scanIntervalMilliseconds = options.scanIntervalMilliseconds ?? 750;
    if (!Number.isFinite(this.#scanIntervalMilliseconds) || this.#scanIntervalMilliseconds <= 0) {
      throw new Error("scanIntervalMilliseconds must be positive");
    }
    this.#setInterval = options.setInterval ?? ((handler, milliseconds) => {
      const handle = setInterval(handler, milliseconds);
      const unref = (handle as unknown as { unref?: () => void }).unref;
      unref?.call(handle);
      return handle;
    });
    this.#clearInterval = options.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
    this.#onError = options.onError;
  }

  async start(): Promise<void> {
    if (this.#active) return;
    this.#active = true;
    try {
      await this.refresh();
      if (!this.#active) return;
      this.#interval = this.#setInterval(() => {
        void this.refresh().catch((error: unknown) => this.#onError?.(error));
      }, this.#scanIntervalMilliseconds);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async refresh(): Promise<void> {
    if (!this.#active) return;
    await this.#syncReaders();
    const results = await Promise.allSettled(
      [...this.#attached.values()].map((attached) => this.#renderAttached(attached)),
    );
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected !== undefined) throw rejected.reason;
  }

  stop(): void {
    this.#active = false;
    if (this.#interval !== undefined) {
      this.#clearInterval(this.#interval);
      this.#interval = undefined;
    }
    for (const attached of this.#attached.values()) this.#detach(attached);
    this.#attached.clear();
  }

  async verifyVisiblePreview(request: VisiblePreviewRequest): Promise<boolean> {
    if (!this.#active || !Number.isSafeInteger(request.attachmentItemId)) return false;
    await this.#syncReaders();
    const candidates = [...this.#attached.values()].filter(
      (candidate) => candidate.reader.itemID === request.attachmentItemId,
    );
    if (candidates.length === 0) return false;
    const rendered = await this.#renderer.render({
      content: request.expectedNativeComment,
      source: "annotation",
      requestedFormat: "sanitized_html",
    });
    if (rendered.format !== "sanitized_html") return false;

    for (const attached of candidates) {
      await this.#renderAttached(attached);
      const expectedMarkup = normalizeMarkup(attached.document, rendered.content);
      const state = attached.reader._internalReader?._state;

      if (state?.sidebarOpen === true && state.sidebarView === "annotations") {
        const row = findAnnotationRow(attached.document, request.annotationKey);
        const preview = row?.querySelector<HTMLElement>(PREVIEW_SELECTOR);
        if (
          row !== undefined &&
          row !== null &&
          previewMatches(preview, request, expectedMarkup, attached.document) &&
          isActuallyVisible(row, attached.document)
        ) {
          return true;
        }
      }

      const selected = state?.selectedAnnotationIDs;
      if (
        Array.isArray(selected) &&
        selected.length === 1 &&
        selected[0] === request.annotationKey
      ) {
        const popup = attached.document.querySelector<HTMLElement>(".annotation-popup");
        const preview = popup?.querySelector<HTMLElement>(PREVIEW_SELECTOR);
        if (
          popup !== undefined &&
          popup !== null &&
          previewMatches(preview, request, expectedMarkup, attached.document) &&
          isActuallyVisible(popup, attached.document)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  async #syncReaders(): Promise<void> {
    const prior = this.#syncing;
    let release: (() => void) | undefined;
    this.#syncing = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try {
      if (!this.#active) return;
      const currentReaders = new Set(this.#host.Reader._readers);
      for (const [reader, attached] of this.#attached) {
        const currentDocument = reader._iframeWindow?.document;
        if (!currentReaders.has(reader) || currentDocument !== attached.document) {
          this.#detach(attached);
          this.#attached.delete(reader);
        }
      }

      for (const reader of currentReaders) {
        if (this.#attached.has(reader)) continue;
        await reader._initPromise;
        await reader._internalReader?._primaryView?.initializedPromise;
        if (!this.#active) return;
        const document = reader._iframeWindow?.document;
        if (document === undefined) continue;
        const attached = this.#attach(reader, document);
        this.#attached.set(reader, attached);
      }
    } finally {
      release?.();
    }
  }

  #attach(reader: ZoteroReaderLike, document: Document): AttachedReader {
    const attached: AttachedReader = {
      reader,
      document,
      observer: undefined,
      clickHandler: () => {},
      rendering: Promise.resolve(),
    };
    attached.clickHandler = (event) => this.#handleClick(attached, event);
    document.addEventListener("click", attached.clickHandler, true);

    const Observer = document.defaultView?.MutationObserver;
    const target = document.body ?? document.documentElement;
    if (Observer !== undefined && target !== null) {
      attached.observer = new Observer(() => {
        void this.#renderAttached(attached).catch((error: unknown) => this.#onError?.(error));
      });
      attached.observer.observe(target, { childList: true, subtree: true, characterData: true });
    }
    return attached;
  }

  #detach(attached: AttachedReader): void {
    attached.observer?.disconnect();
    attached.document.removeEventListener("click", attached.clickHandler, true);
    removeOwnedNodes(attached.document);
  }

  #renderAttached(attached: AttachedReader): Promise<void> {
    const operation = attached.rendering.then(async () => {
      if (!this.#active || this.#attached.get(attached.reader) !== attached) return;
      try {
        await this.#renderDocument(attached);
      } catch (error) {
        removeOwnedNodes(attached.document);
        throw error;
      }
    });
    attached.rendering = operation.catch(() => {});
    return operation;
  }

  async #renderDocument(attached: AttachedReader): Promise<void> {
    const { document, reader } = attached;
    ensureStyle(document);
    const retained = new Set<Element>();
    const itemID = reader.itemID;
    if (!Number.isSafeInteger(itemID)) {
      removeStalePreviews(document, retained);
      return;
    }

    for (const row of document.querySelectorAll<HTMLElement>("[data-sidebar-annotation-id]")) {
      const annotationKey = row.getAttribute("data-sidebar-annotation-id");
      if (!annotationKey) continue;
      const preview = await this.#renderComment(
        attached,
        row.querySelector<HTMLElement>(".comment"),
        annotationKey,
        itemID as number,
      );
      if (preview !== undefined) retained.add(preview);
    }

    const selected = reader._internalReader?._state?.selectedAnnotationIDs;
    if (Array.isArray(selected) && selected.length === 1 && typeof selected[0] === "string") {
      const popup = document.querySelector<HTMLElement>(".annotation-popup");
      const preview = await this.#renderComment(
        attached,
        popup?.querySelector<HTMLElement>(".comment") ?? null,
        selected[0],
        itemID as number,
      );
      if (preview !== undefined) retained.add(preview);
    }
    removeStalePreviews(document, retained);
  }

  async #renderComment(
    attached: AttachedReader,
    comment: HTMLElement | null,
    annotationKey: string,
    attachmentItemId: number,
  ): Promise<HTMLElement | undefined> {
    if (comment === null) return undefined;
    const editor = comment.querySelector<HTMLElement>(".content");
    if (editor === null) return undefined;
    const source = typeof editor.innerText === "string" ? editor.innerText : (editor.textContent ?? "");
    let preview = comment.querySelector<HTMLElement>(PREVIEW_SELECTOR);
    if (source.length === 0) {
      preview?.remove();
      comment.removeAttribute(COMMENT_MODE_ATTRIBUTE);
      return undefined;
    }

    const rendered = await this.#renderer.render({
      content: source,
      source: "annotation",
      requestedFormat: "sanitized_html",
    });
    if (
      !this.#active ||
      this.#attached.get(attached.reader) !== attached ||
      attached.reader._iframeWindow?.document !== attached.document ||
      !comment.isConnected
    ) {
      return undefined;
    }
    if (preview === null) {
      preview = comment.ownerDocument.createElement("section");
      preview.setAttribute(PREVIEW_ATTRIBUTE, "true");
      preview.setAttribute("role", "region");
      preview.setAttribute("aria-label", "Formatted annotation comment");
      preview.setAttribute("contenteditable", "false");
      preview.tabIndex = 0;
      preview.style.maxHeight = "none";
      preview.style.overflowY = "visible";
      const toolbar = comment.ownerDocument.createElement("div");
      toolbar.className = "zotero-gpt-rendered-toolbar";
      const toggle = comment.ownerDocument.createElement("button");
      toggle.type = "button";
      toggle.setAttribute(TOGGLE_ATTRIBUTE, "true");
      toggle.textContent = "Edit native comment";
      toolbar.append(toggle);
      const body = comment.ownerDocument.createElement("div");
      body.setAttribute(PREVIEW_BODY_ATTRIBUTE, "true");
      preview.append(toolbar, body);
      comment.append(preview);
    }
    if (!comment.hasAttribute(COMMENT_MODE_ATTRIBUTE)) {
      comment.setAttribute(COMMENT_MODE_ATTRIBUTE, "preview");
    }
    preview.setAttribute("data-zotero-annotation-key", annotationKey);
    preview.setAttribute("data-zotero-attachment-item-id", String(attachmentItemId));
    const body = preview.querySelector<HTMLElement>(`[${PREVIEW_BODY_ATTRIBUTE}]`);
    if (body === null) throw new Error("The formatted comment body is unavailable");
    if (rendered.format === "sanitized_html") {
      const expected = normalizeMarkup(comment.ownerDocument, rendered.content);
      if (body.innerHTML !== expected) body.innerHTML = rendered.content;
    } else if (body.textContent !== rendered.content) {
      body.textContent = rendered.content;
    }
    return preview;
  }

  #handleClick(attached: AttachedReader, event: Event): void {
    const target = event.target as { closest?(selector: string): Element | null } | null;
    const toggle = target?.closest?.(`${PREVIEW_SELECTOR} [${TOGGLE_ATTRIBUTE}]`);
    if (toggle !== null && toggle !== undefined) {
      const preview = toggle.closest(PREVIEW_SELECTOR);
      const comment = preview?.parentElement;
      if (comment === null || comment === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      const showSource = comment.getAttribute(COMMENT_MODE_ATTRIBUTE) !== "source";
      comment.setAttribute(COMMENT_MODE_ATTRIBUTE, showSource ? "source" : "preview");
      toggle.textContent = showSource ? "Show formatted comment" : "Edit native comment";
      if (showSource) comment.querySelector<HTMLElement>(".content")?.focus();
      else void this.#renderAttached(attached).catch((error: unknown) => this.#onError?.(error));
      return;
    }
    const link = target?.closest?.(`${PREVIEW_SELECTOR} a[href]`);
    if (link === null || link === undefined || link.ownerDocument !== attached.document) return;
    const href = link.getAttribute("href");
    event.preventDefault();
    event.stopPropagation();
    if (href === null || !isSafeReferenceUrl(href)) return;
    try {
      this.#openLink(href);
    } catch (error) {
      this.#onError?.(error);
    }
  }
}

function ensureStyle(document: Document): void {
  if (document.querySelector(`[${STYLE_ATTRIBUTE}]`) !== null) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "true");
  style.textContent = `
    [${PREVIEW_ATTRIBUTE}] {
      box-sizing: border-box;
      max-height: none !important;
      overflow-y: visible !important;
      overflow-wrap: anywhere;
      padding: 8px;
      user-select: text;
      white-space: normal;
    }
    .comment[${COMMENT_MODE_ATTRIBUTE}="preview"] > .content,
    .comment[${COMMENT_MODE_ATTRIBUTE}="preview"] > .editor,
    .comment[${COMMENT_MODE_ATTRIBUTE}="preview"] > .expandable-editor {
      display: none !important;
    }
    .comment[${COMMENT_MODE_ATTRIBUTE}="source"] [${PREVIEW_BODY_ATTRIBUTE}] {
      display: none !important;
    }
    [${PREVIEW_ATTRIBUTE}] .zotero-gpt-rendered-toolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 4px;
    }
    [${PREVIEW_ATTRIBUTE}] [${TOGGLE_ATTRIBUTE}] {
      background: transparent;
      border: 0;
      color: var(--accent-blue);
      cursor: pointer;
      font: inherit;
      padding: 0;
      text-decoration: underline;
    }
    [${PREVIEW_ATTRIBUTE}] > :first-child { margin-top: 0; }
    [${PREVIEW_ATTRIBUTE}] > :last-child { margin-bottom: 0; }
    [${PREVIEW_ATTRIBUTE}] a { color: var(--accent-blue); text-decoration: underline; }
    [${PREVIEW_ATTRIBUTE}] pre,
    [${PREVIEW_ATTRIBUTE}] .katex-display { max-width: 100%; overflow-x: auto; }
    [${PREVIEW_ATTRIBUTE}] math { max-width: 100%; }
    [${PREVIEW_ATTRIBUTE}] h1,
    [${PREVIEW_ATTRIBUTE}] h2,
    [${PREVIEW_ATTRIBUTE}] h3,
    [${PREVIEW_ATTRIBUTE}] h4,
    [${PREVIEW_ATTRIBUTE}] h5,
    [${PREVIEW_ATTRIBUTE}] h6 { font-size: 1em; }
  `;
  (document.head ?? document.documentElement).append(style);
}

function removeOwnedNodes(document: Document): void {
  for (const comment of document.querySelectorAll(`[${COMMENT_MODE_ATTRIBUTE}]`)) {
    comment.removeAttribute(COMMENT_MODE_ATTRIBUTE);
  }
  for (const node of document.querySelectorAll(`${PREVIEW_SELECTOR}, [${STYLE_ATTRIBUTE}]`)) {
    node.remove();
  }
}

function removeStalePreviews(document: Document, retained: ReadonlySet<Element>): void {
  for (const node of document.querySelectorAll(PREVIEW_SELECTOR)) {
    if (!retained.has(node)) {
      node.parentElement?.removeAttribute(COMMENT_MODE_ATTRIBUTE);
      node.remove();
    }
  }
}

function findAnnotationRow(document: Document, annotationKey: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("[data-sidebar-annotation-id]")].find(
    (row) => row.getAttribute("data-sidebar-annotation-id") === annotationKey,
  );
}

function previewMatches(
  preview: HTMLElement | null | undefined,
  request: VisiblePreviewRequest,
  expectedMarkup: string,
  document: Document,
): preview is HTMLElement {
  const body = preview?.querySelector<HTMLElement>(`[${PREVIEW_BODY_ATTRIBUTE}]`);
  return (
    preview !== null &&
    preview !== undefined &&
    preview.getAttribute("data-zotero-annotation-key") === request.annotationKey &&
    preview.getAttribute("data-zotero-attachment-item-id") === String(request.attachmentItemId) &&
    preview.parentElement?.getAttribute(COMMENT_MODE_ATTRIBUTE) === "preview" &&
    body?.innerHTML === expectedMarkup &&
    isActuallyVisible(preview, document)
  );
}

function normalizeMarkup(document: Document, markup: string): string {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const container = document.createElement("div");
  container.append(template.content.cloneNode(true));
  return container.innerHTML;
}

function clipsOverflow(value: string): boolean {
  return value === "auto" || value === "clip" || value === "hidden" || value === "scroll";
}

function isActuallyVisible(node: HTMLElement, document: Document): boolean {
  if (!node.isConnected || node.getClientRects().length === 0) return false;
  const view = document.defaultView;
  if (view === null) return false;
  const width = view.innerWidth || document.documentElement.clientWidth;
  const height = view.innerHeight || document.documentElement.clientHeight;
  if (width <= 0 || height <= 0) return false;

  const rect = node.getBoundingClientRect();
  if (![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)) return false;
  let left = Math.max(0, rect.left);
  let right = Math.min(width, rect.right);
  let top = Math.max(0, rect.top);
  let bottom = Math.min(height, rect.bottom);
  if (right <= left || bottom <= top) return false;

  for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
    const style = view.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    if (current === node) continue;
    const clipX = clipsOverflow(style.overflowX || style.overflow);
    const clipY = clipsOverflow(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;
    const ancestor = current.getBoundingClientRect();
    if (clipX) {
      left = Math.max(left, ancestor.left);
      right = Math.min(right, ancestor.right);
    }
    if (clipY) {
      top = Math.max(top, ancestor.top);
      bottom = Math.min(bottom, ancestor.bottom);
    }
    if (right <= left || bottom <= top) return false;
  }
  return true;
}
