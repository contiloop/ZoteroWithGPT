import { CoreOperationError } from "../../core/errors.js";
import type { NativeRectangle, ResolvedAnchor } from "../../protocol/types.js";
import type { WebCryptoLike } from "../operation-store/web-crypto-digest.js";
import type { NativePageChar, NativeRectTuple } from "../anchors/text-layer.js";
import {
  OPERATION_RELATION_PREDICATE,
} from "./record-utils.js";
import type {
  NativeAnnotationCreate,
  NativeAnnotationRecord,
  NativeAnnotationUpdate,
  NativeInspectedRegionEvidence,
  NativeMutationRecord,
  NativeNoteCreate,
  NativeNoteRecord,
  NativeNoteUpdate,
  NativePaperRecord,
  NativePdfAttachment,
  NativePdfPageRecord,
  NativeRuntimeStatus,
  ZoteroAccessGate,
  ZoteroNativeApi,
} from "./native-api.js";

interface ZoteroCreatorLike {
  firstName?: string;
  lastName?: string;
  name?: string;
}

interface ZoteroItemLike {
  id?: number;
  key?: string;
  libraryID?: number;
  parentID?: number;
  parentItemID?: number | false;
  itemType?: string;
  deleted?: boolean;
  version?: number;
  dateModified?: string;
  attachmentContentType?: string;
  annotationType?: string;
  annotationText?: string;
  annotationComment?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationSortIndex?: string;
  annotationPosition?: string;
  isPDFAttachment(): boolean;
  isRegularItem(): boolean;
  isAnnotation(): boolean;
  isNote(): boolean;
  isEditable(): boolean;
  getField(field: string, unformatted?: boolean, includeBaseMapped?: boolean): unknown;
  getDisplayTitle(): string;
  getCreators?(): ZoteroCreatorLike[];
  getAttachments?(includeTrashed?: boolean): number[];
  getAnnotations?(): ZoteroItemLike[];
  getNotes?(includeTrashed?: boolean): number[];
  getFilePathAsync(): Promise<string | false | undefined>;
  getRelationsByPredicate(predicate: string): string[];
  addRelation(predicate: string, object: string): boolean;
  getNote?(): string;
  getNoteTitle?(): string;
  setNote?(content: string): void;
  loadAllData?(): Promise<unknown>;
  saveTx(options?: Record<string, unknown>): Promise<unknown>;
}

interface ZoteroSearchLike {
  libraryID: number;
  addCondition(condition: string, operator: string, value: string): void;
  search(): Promise<number[]>;
}

interface PdfCharLike {
  u?: unknown;
  c?: unknown;
  rect?: unknown;
  inlineRect?: unknown;
  spaceAfter?: unknown;
  lineBreakAfter?: unknown;
  paragraphBreakAfter?: unknown;
  ignorable?: unknown;
}

interface PdfPageDataLike {
  viewBox?: unknown;
  chars?: unknown;
}

interface PdfDocumentLike {
  numPages?: unknown;
  getData?(): Promise<Uint8Array | ArrayBuffer>;
  getPageLabels2?(): Promise<unknown>;
  getPageData(input: { pageIndex: number }): Promise<PdfPageDataLike>;
}

interface SelectionAnnotationLike {
  text?: unknown;
  position?: { pageIndex?: unknown; rects?: unknown };
}

interface ReaderPrimaryViewLike {
  initializedPromise?: Promise<unknown>;
  _iframeWindow?: {
    PDFViewerApplication?: { pdfDocument?: PdfDocumentLike };
    document?: QueryDocumentLike;
  };
  _selectionRanges?: unknown[];
  _getAnnotationFromSelectionRanges?(
    ranges: unknown[],
    type: "highlight",
  ): SelectionAnnotationLike | null;
  getAnnotationMeta?(position: { pageIndex: number; rects: NativeRectTuple[] }):
    | { sortIndex?: unknown; pageLabel?: unknown }
    | null;
}

interface ReaderLike {
  itemID?: number;
  _iframeWindow?: { document?: QueryDocumentLike };
  _initPromise?: Promise<unknown>;
  _internalReader?: {
    _primaryView?: ReaderPrimaryViewLike;
    _state?: {
      annotations?: unknown;
      selectedAnnotationIDs?: unknown;
      sidebarOpen?: unknown;
      sidebarView?: unknown;
    };
  };
  close?(): void;
}

interface ZoteroLibraryLike {
  libraryID?: number;
  waitForDataLoad?(type: string): Promise<unknown>;
}

export interface ZoteroHostGlobal {
  version?: string;
  Profile?: { name?: string };
  Libraries: { getAll(): ZoteroLibraryLike[] };
  Items: {
    getByLibraryAndKeyAsync(
      libraryId: number,
      key: string,
      options?: { noCache?: boolean },
    ): Promise<ZoteroItemLike | false | undefined>;
    getAsync(
      ids: number | number[],
      options?: { noCache?: boolean },
    ): Promise<ZoteroItemLike | ZoteroItemLike[] | false | undefined>;
    get(id: number): ZoteroItemLike | false | undefined;
  };
  Search: new () => ZoteroSearchLike;
  Item: new (type: string) => ZoteroItemLike;
  Reader: {
    _readers: ReaderLike[];
    open(
      itemId: number,
      location?: null,
      options?: { openInBackground?: boolean; allowDuplicate?: boolean },
    ): Promise<ReaderLike | undefined>;
  };
  Annotations: {
    saveFromJSON(
      attachment: ZoteroItemLike,
      json: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<ZoteroItemLike>;
  };
  Relations: {
    getByPredicateAndObject(
      objectType: "item",
      predicate: string,
      object: string,
    ): Promise<ZoteroItemLike[]>;
  };
  DataObjectUtilities: { generateKey(): string };
  API: { getLibraryPrefix(libraryId: number): string };
  Promise?: { delay(milliseconds: number): Promise<unknown> };
}

export interface ZoteroNativeEnvironment {
  Zotero: ZoteroHostGlobal;
  IOUtils: { read(path: string): Promise<Uint8Array | ArrayBuffer> };
  crypto: WebCryptoLike;
  cloneInto<T>(value: T, target: object): T;
  accessGate?: ZoteroAccessGate;
}

interface QueryNodeLike {
  textContent?: string | null;
  isConnected?: boolean;
  getClientRects?(): { length: number };
  getBoundingClientRect?(): QueryRectLike;
  parentElement?: QueryNodeLike | null;
  querySelector?(selector: string): QueryNodeLike | null;
}

interface QueryRectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface QueryStyleLike {
  display?: string;
  visibility?: string;
  opacity?: string;
  contentVisibility?: string;
  overflow?: string;
  overflowX?: string;
  overflowY?: string;
}

interface QueryDocumentLike {
  defaultView?: {
    innerWidth?: number;
    innerHeight?: number;
    getComputedStyle?(node: QueryNodeLike): QueryStyleLike;
  };
  documentElement?: { clientWidth?: number; clientHeight?: number };
  querySelector(selector: string): QueryNodeLike | null;
}

function libraryId(value: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new CoreOperationError("invalid_request", `Invalid Zotero library ID '${value}'`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new CoreOperationError("invalid_request", `Invalid Zotero library ID '${value}'`);
  }
  return parsed;
}

function requiredNumber(value: number | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) throw new Error(`Native ${label} is missing`);
  return value as number;
}

function requiredString(value: string | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Native ${label} is missing`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tuple(value: unknown): NativeRectTuple | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  ) {
    return undefined;
  }
  return [value[0] as number, value[1] as number, value[2] as number, value[3] as number];
}

function rectangle(value: unknown): NativeRectangle | undefined {
  const source = tuple(value);
  if (source === undefined || source[2] <= source[0] || source[3] <= source[1]) return undefined;
  return { x1: source[0], y1: source[1], x2: source[2], y2: source[3] };
}

function rectangles(value: unknown): NativeRectangle[] {
  if (!Array.isArray(value)) return [];
  return value.map(rectangle).filter((entry): entry is NativeRectangle => entry !== undefined);
}

function rectangleTuples(value: readonly NativeRectangle[]): NativeRectTuple[] {
  return value.map((entry) => [entry.x1, entry.y1, entry.x2, entry.y2]);
}

function parsePosition(item: ZoteroItemLike): { pageIndex: number; rectangles: NativeRectangle[] } {
  let value: unknown;
  try {
    value = JSON.parse(requiredString(item.annotationPosition, "annotation position"));
  } catch {
    throw new Error(`Native annotation '${item.key ?? "unknown"}' has an invalid position`);
  }
  if (value === null || typeof value !== "object") {
    throw new Error(`Native annotation '${item.key ?? "unknown"}' has an invalid position`);
  }
  const position = value as { pageIndex?: unknown; rects?: unknown };
  if (!Number.isInteger(position.pageIndex) || (position.pageIndex as number) < 0) {
    throw new Error(`Native annotation '${item.key ?? "unknown"}' has an invalid page index`);
  }
  const parsedRectangles = rectangles(position.rects);
  if (parsedRectangles.length === 0) {
    throw new Error(`Native annotation '${item.key ?? "unknown"}' has no valid rectangles`);
  }
  return { pageIndex: position.pageIndex as number, rectangles: parsedRectangles };
}

function creatorName(creator: ZoteroCreatorLike): string | undefined {
  const name = creator.name?.trim();
  if (name) return name;
  const joined = [creator.firstName, creator.lastName]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();
  return joined || undefined;
}

function yearFor(item: ZoteroItemLike): number | undefined {
  const value = String(item.getField("date", false, true) ?? "");
  const match = /(?:^|\D)([12][0-9]{3})(?:\D|$)/u.exec(value);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function annotationMaterial(record: NativeAnnotationRecord): string {
  return JSON.stringify({
    libraryId: record.libraryId,
    itemKey: record.itemKey,
    attachmentKey: record.attachmentKey,
    annotationKey: record.annotationKey,
    type: record.type,
    text: record.text ?? null,
    comment: record.comment,
    color: record.color ?? null,
    pageIndex: record.pageIndex,
    pageLabel: record.pageLabel,
    rectangles: record.rectangles,
    version: record.version,
    dateModified: record.dateModified,
    operationMarkers: [...record.operationMarkers].sort(),
  });
}

function noteMaterial(record: NativeNoteRecord): string {
  return JSON.stringify({
    libraryId: record.libraryId,
    itemKey: record.itemKey,
    noteKey: record.noteKey,
    title: record.title,
    content: record.content,
    version: record.version,
    dateModified: record.dateModified,
    operationMarkers: [...record.operationMarkers].sort(),
  });
}

function clipsOverflow(value: string | undefined): boolean {
  return value === "auto" || value === "clip" || value === "hidden" || value === "scroll";
}

function isRenderedNode(
  node: QueryNodeLike | null | undefined,
  document: QueryDocumentLike | undefined,
): node is QueryNodeLike {
  if (
    node?.isConnected !== true ||
    node.getClientRects === undefined ||
    node.getClientRects().length === 0 ||
    node.getBoundingClientRect === undefined ||
    document === undefined
  ) {
    return false;
  }
  const width = document.defaultView?.innerWidth ?? document.documentElement?.clientWidth;
  const height = document.defaultView?.innerHeight ?? document.documentElement?.clientHeight;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    (width ?? 0) <= 0 ||
    (height ?? 0) <= 0
  ) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  if (![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)) return false;
  let left = Math.max(0, rect.left);
  let right = Math.min(width as number, rect.right);
  let top = Math.max(0, rect.top);
  let bottom = Math.min(height as number, rect.bottom);
  if (right <= left || bottom <= top) return false;

  for (
    let current: QueryNodeLike | null | undefined = node;
    current;
    current = current.parentElement
  ) {
    const style = document.defaultView?.getComputedStyle?.(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse" ||
      style?.contentVisibility === "hidden" ||
      (style?.opacity !== undefined && Number(style.opacity) === 0)
    ) {
      return false;
    }
    if (current === node || style === undefined) continue;
    const clipX = clipsOverflow(style.overflowX || style.overflow);
    const clipY = clipsOverflow(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;
    const ancestor = current.getBoundingClientRect?.();
    if (ancestor === undefined) return false;
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

function mapPageChars(value: unknown): NativePageChar[] {
  if (!Array.isArray(value)) return [];
  const output: NativePageChar[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object") continue;
    const source = raw as PdfCharLike;
    const rect = tuple(source.rect);
    const text = typeof source.u === "string" ? source.u : typeof source.c === "string" ? source.c : "";
    if (rect === undefined || text.length === 0) continue;
    const inlineRect = tuple(source.inlineRect);
    output.push({
      text,
      rect,
      ...(inlineRect === undefined ? {} : { inlineRect }),
      spaceAfter: source.spaceAfter === true,
      lineBreakAfter: source.lineBreakAfter === true,
      paragraphBreakAfter: source.paragraphBreakAfter === true,
      ignorable: source.ignorable === true,
    });
  }
  return output;
}

export class ZoteroGlobalNativeApi implements ZoteroNativeApi {
  readonly #zotero: ZoteroHostGlobal;
  readonly #io: ZoteroNativeEnvironment["IOUtils"];
  readonly #crypto: WebCryptoLike;
  readonly #cloneInto: ZoteroNativeEnvironment["cloneInto"];
  readonly #accessGate: ZoteroAccessGate | undefined;

  constructor(environment: ZoteroNativeEnvironment) {
    this.#zotero = environment.Zotero;
    this.#io = environment.IOUtils;
    this.#crypto = environment.crypto;
    this.#cloneInto = environment.cloneInto;
    this.#accessGate = environment.accessGate;
  }

  async runtimeStatus(): Promise<NativeRuntimeStatus> {
    const profileName = optionalString(this.#zotero.Profile?.name);
    return {
      zoteroVersion: this.#zotero.version ?? "unknown",
      ...(profileName === undefined ? {} : { profileName }),
    };
  }

  async searchPapers(query: string, limit: number): Promise<NativePaperRecord[]> {
    const results: NativePaperRecord[] = [];
    for (const library of this.#zotero.Libraries.getAll()) {
      const id = library.libraryID;
      if (!Number.isSafeInteger(id) || (id ?? 0) <= 0) continue;
      await library.waitForDataLoad?.("item");
      const search = new this.#zotero.Search();
      search.libraryID = id as number;
      search.addCondition("quicksearch-titleCreatorYear", "contains", query);
      const ids = await search.search();
      const loaded = await this.#zotero.Items.getAsync(ids);
      const items = Array.isArray(loaded) ? loaded : loaded ? [loaded] : [];
      for (const item of items) {
        if (!item.isRegularItem() || item.deleted === true) continue;
        await item.loadAllData?.();
        const attachments: NativePaperRecord["attachments"] = [];
        const childIds = item.getAttachments?.(false) ?? [];
        const childrenValue = await this.#zotero.Items.getAsync(childIds);
        const children = Array.isArray(childrenValue)
          ? childrenValue
          : childrenValue
            ? [childrenValue]
            : [];
        for (const attachment of children) {
          if (!attachment.isPDFAttachment() || attachment.deleted === true) continue;
          let fingerprint: string | undefined;
          try {
            fingerprint = await this.#fingerprint(attachment);
          } catch {
            fingerprint = undefined;
          }
          attachments.push({
            attachmentKey: requiredString(attachment.key, "attachment key"),
            title: String(
              attachment.getField("title") || attachment.getDisplayTitle() || "PDF attachment",
            ),
            contentType: attachment.attachmentContentType ?? "application/pdf",
            ...(fingerprint === undefined ? {} : { fingerprint }),
          });
        }
        const year = yearFor(item);
        results.push({
          libraryId: String(id),
          itemKey: requiredString(item.key, "item key"),
          title: String(item.getField("title") || item.getDisplayTitle() || "Untitled"),
          creators: (item.getCreators?.() ?? [])
            .map(creatorName)
            .filter((name): name is string => name !== undefined),
          ...(year === undefined ? {} : { year }),
          attachments,
        });
      }
    }
    return results.slice(0, limit);
  }

  async getPdfAttachment(
    requestedLibraryId: string,
    attachmentKey: string,
    itemKey?: string,
  ): Promise<NativePdfAttachment | undefined> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (
      attachment === undefined ||
      attachment.deleted === true ||
      !attachment.isPDFAttachment()
    ) {
      return undefined;
    }
    const parent = await this.#parentRecord(attachment);
    const parentKey = parent?.key ?? attachment.key;
    if (parentKey === undefined || (itemKey !== undefined && parentKey !== itemKey)) return undefined;
    const readerSnapshot = await this.#withReader(
      requiredNumber(attachment.id, "attachment ID"),
      true,
      async (_reader, view) => {
        const document = view._iframeWindow?.PDFViewerApplication?.pdfDocument;
        if (document === undefined) throw new Error("The Zotero reader PDF document is unavailable");
        const count = document.numPages;
        if (!Number.isSafeInteger(count) || (count as number) <= 0) {
          throw new Error("The initialized Zotero PDF reader did not expose a page count");
        }
        return {
          pageCount: count as number,
          fingerprint: await this.#readerFingerprint(document),
        };
      },
    );
    const fingerprint = await this.#fingerprint(attachment);
    if (readerSnapshot.fingerprint !== fingerprint) {
      throw new CoreOperationError(
        "stale_attachment",
        "The open Zotero reader is displaying different PDF bytes; reload the reader and retry",
      );
    }
    return {
      libraryId: String(requiredNumber(attachment.libraryID, "library ID")),
      itemKey: parentKey,
      attachmentKey: requiredString(attachment.key, "attachment key"),
      title: String(attachment.getField("title") || attachment.getDisplayTitle() || "PDF attachment"),
      contentType: attachment.attachmentContentType ?? "application/pdf",
      fingerprint,
      revision: await this.#digestText(
        JSON.stringify({
          fingerprint,
          version: attachment.version ?? 0,
          dateModified: attachment.dateModified ?? "",
        }),
      ),
      pageCount: readerSnapshot.pageCount,
    };
  }

  async readPdfPage(
    attachment: NativePdfAttachment,
    pageIndex: number,
  ): Promise<NativePdfPageRecord> {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= attachment.pageCount) {
      throw new CoreOperationError("not_found", "The requested PDF page is out of range");
    }
    const item = await this.#fresh(attachment.libraryId, attachment.attachmentKey);
    if (item === undefined || !item.isPDFAttachment()) {
      throw new CoreOperationError("not_found", "The requested PDF attachment is no longer available");
    }
    const result = await this.#withReader(
      requiredNumber(item.id, "attachment ID"),
      true,
      async (_reader, view) => {
        const frame = view._iframeWindow;
        if (frame === undefined) throw new Error("The Zotero reader PDF frame is unavailable");
        const document = frame.PDFViewerApplication?.pdfDocument;
        if (document === undefined) throw new Error("The Zotero reader PDF document is unavailable");
        if ((await this.#readerFingerprint(document)) !== attachment.fingerprint) {
          throw new CoreOperationError(
            "stale_attachment",
            "The open Zotero reader is displaying different PDF bytes; reload the reader and retry",
          );
        }
        const data = await document.getPageData(this.#cloneInto({ pageIndex }, frame));
        const viewBox = tuple(data.viewBox);
        if (viewBox === undefined) throw new Error("The Zotero reader returned an invalid PDF view box");
        const labelsValue = await document.getPageLabels2?.();
        const labels = Array.isArray(labelsValue) ? labelsValue : [];
        return {
          pageIndex,
          pageLabel: optionalString(labels[pageIndex]) ?? String(pageIndex + 1),
          viewBox,
          chars: mapPageChars(data.chars),
        };
      },
    );
    if ((await this.#fingerprint(item)) !== attachment.fingerprint) {
      throw new CoreOperationError(
        "stale_attachment",
        "The PDF bytes changed while the native page was being read",
      );
    }
    return result;
  }

  async confirmInspectedRegion(
    requestedLibraryId: string,
    attachmentKey: string,
    pageIndex: number,
  ): Promise<NativeInspectedRegionEvidence | undefined> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment() || attachment.id === undefined) {
      return undefined;
    }
    return this.#withReader(attachment.id, false, async (_reader, view) => {
      const ranges = view._selectionRanges;
      const derive = view._getAnnotationFromSelectionRanges;
      if (ranges === undefined || ranges.length === 0 || derive === undefined) return undefined;
      const selected = derive.call(view, ranges, "highlight");
      if (selected?.position?.pageIndex !== pageIndex) return undefined;
      const selectedRectangles = rectangles(selected.position.rects);
      if (selectedRectangles.length === 0) return undefined;
      return {
        rectangles: selectedRectangles,
        ...(typeof selected.text === "string" && selected.text.length > 0
          ? { selectedText: selected.text }
          : {}),
      };
    });
  }

  async listAnnotations(
    requestedLibraryId: string,
    attachmentKey: string,
  ): Promise<NativeAnnotationRecord[]> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment()) return [];
    await attachment.loadAllData?.();
    const annotations = attachment.getAnnotations?.() ?? [];
    const records: NativeAnnotationRecord[] = [];
    for (const candidate of annotations) {
      if (candidate.key === undefined) continue;
      const annotation = await this.#fresh(requestedLibraryId, candidate.key);
      if (
        annotation === undefined ||
        !annotation.isAnnotation() ||
        annotation.deleted === true ||
        annotation.parentItemID !== attachment.id
      ) {
        continue;
      }
      const record = await this.#annotationRecord(annotation, attachment);
      if (record !== undefined) records.push(record);
    }
    return records;
  }

  async getAnnotation(
    requestedLibraryId: string,
    attachmentKey: string,
    annotationKey: string,
  ): Promise<NativeAnnotationRecord | undefined> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment()) return undefined;
    const annotation = await this.#fresh(requestedLibraryId, annotationKey);
    if (
      annotation === undefined ||
      !annotation.isAnnotation() ||
      annotation.deleted === true ||
      annotation.parentItemID !== attachment.id
    ) {
      return undefined;
    }
    return this.#annotationRecord(annotation, attachment);
  }

  async createAnnotation(input: NativeAnnotationCreate): Promise<NativeAnnotationRecord> {
    const attachment = await this.#fresh(input.anchor.libraryId, input.anchor.attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment() || attachment.deleted === true) {
      throw new CoreOperationError("not_found", "The annotation PDF attachment was not found");
    }
    if (!attachment.isEditable()) {
      throw new CoreOperationError("permission_denied", "The PDF attachment is not editable");
    }
    const parent = await this.#parentRecord(attachment);
    if ((parent?.key ?? attachment.key) !== input.anchor.itemKey) {
      throw new CoreOperationError("unresolved_anchor", "The PDF belongs to a different parent item");
    }
    if ((await this.#fingerprint(attachment)) !== input.anchor.attachmentFingerprint) {
      throw new CoreOperationError("stale_attachment", "The PDF bytes changed before annotation commit");
    }
    const position = {
      pageIndex: input.anchor.pageIndex,
      rects: rectangleTuples(input.anchor.rectangles),
    };
    const meta = await this.#withReader(
      requiredNumber(attachment.id, "attachment ID"),
      true,
      async (_reader, view) => view.getAnnotationMeta?.(position) ?? null,
    );
    const sortIndex = optionalString(meta?.sortIndex);
    const pageLabel = optionalString(meta?.pageLabel) ?? input.anchor.pageLabel;
    if (sortIndex === undefined) {
      throw new CoreOperationError(
        "unresolved_anchor",
        "The native Zotero reader could not derive annotation ordering metadata",
      );
    }
    if (pageLabel !== input.anchor.pageLabel) {
      throw new CoreOperationError(
        "unresolved_anchor",
        "The native Zotero page label changed before annotation commit",
      );
    }
    const current = await this.#fresh(input.anchor.libraryId, input.anchor.attachmentKey);
    if (
      current === undefined ||
      !current.isPDFAttachment() ||
      (await this.#fingerprint(current)) !== input.anchor.attachmentFingerprint
    ) {
      throw new CoreOperationError("stale_attachment", "The PDF bytes changed before annotation commit");
    }
    const key = this.#zotero.DataObjectUtilities.generateKey();
    this.#assertMutationEnabled();
    const saved = await this.#zotero.Annotations.saveFromJSON(
      current,
      {
        key,
        type: input.type,
        ...(input.type === "highlight" ? { text: input.anchor.selectedText ?? "" } : {}),
        comment: input.comment,
        color: input.color,
        pageLabel,
        sortIndex,
        position,
        relations: { [OPERATION_RELATION_PREDICATE]: input.operationMarker },
      },
      { skipSelect: true },
    );
    const fresh = await this.#fresh(input.anchor.libraryId, requiredString(saved.key, "annotation key"));
    if (fresh === undefined) throw new Error("The committed native annotation could not be reloaded");
    const record = await this.#annotationRecord(fresh, current);
    if (record === undefined) throw new Error("The committed native annotation has an unsupported type");
    return record;
  }

  async updateAnnotation(input: NativeAnnotationUpdate): Promise<NativeAnnotationRecord> {
    const attachment = await this.#fresh(
      input.expected.libraryId,
      input.expected.attachmentKey,
    );
    const item = await this.#fresh(input.expected.libraryId, input.expected.annotationKey);
    if (
      attachment === undefined ||
      !attachment.isPDFAttachment() ||
      item === undefined ||
      !item.isAnnotation() ||
      item.parentItemID !== attachment.id
    ) {
      throw new CoreOperationError("not_found", "The annotation was not found");
    }
    const fresh = await this.#annotationRecord(item, attachment);
    if (fresh === undefined) {
      throw new CoreOperationError("unsupported_capability", "The annotation type is not supported");
    }
    if (annotationMaterial(fresh) !== annotationMaterial(input.expected)) {
      throw new CoreOperationError(
        "conflict",
        "The native annotation changed after authorization; reread it before updating",
      );
    }
    if (!item.isEditable()) {
      throw new CoreOperationError("permission_denied", "The annotation is not editable");
    }
    item.annotationComment = input.comment;
    item.addRelation(OPERATION_RELATION_PREDICATE, input.operationMarker);
    this.#assertMutationEnabled();
    await item.saveTx({ skipSelect: true });
    const record = await this.getAnnotation(
      input.expected.libraryId,
      input.expected.attachmentKey,
      input.expected.annotationKey,
    );
    if (record === undefined) throw new Error("The updated native annotation could not be reloaded");
    return record;
  }

  async listNotes(requestedLibraryId: string, itemKey: string): Promise<NativeNoteRecord[]> {
    const parent = await this.#fresh(requestedLibraryId, itemKey);
    if (parent === undefined || !parent.isRegularItem() || parent.deleted === true) return [];
    await parent.loadAllData?.();
    const ids = parent.getNotes?.(false) ?? [];
    const records: NativeNoteRecord[] = [];
    for (const id of ids) {
      const value = await this.#zotero.Items.getAsync(id, { noCache: true });
      if (Array.isArray(value) || !value || !value.isNote() || value.deleted === true) continue;
      records.push(await this.#noteRecord(value, parent));
    }
    return records;
  }

  async getNote(
    requestedLibraryId: string,
    itemKey: string,
    noteKey: string,
  ): Promise<NativeNoteRecord | undefined> {
    const parent = await this.#fresh(requestedLibraryId, itemKey);
    const note = await this.#fresh(requestedLibraryId, noteKey);
    if (
      parent === undefined ||
      !parent.isRegularItem() ||
      note === undefined ||
      !note.isNote() ||
      note.deleted === true ||
      note.parentItemID !== parent.id
    ) {
      return undefined;
    }
    return this.#noteRecord(note, parent);
  }

  async createNote(input: NativeNoteCreate): Promise<NativeNoteRecord> {
    const parent = await this.#fresh(input.libraryId, input.itemKey);
    if (parent === undefined || !parent.isRegularItem() || parent.deleted === true) {
      throw new CoreOperationError("not_found", "The parent library item was not found");
    }
    if (!parent.isEditable()) {
      throw new CoreOperationError("permission_denied", "The parent library item is not editable");
    }
    const note = new this.#zotero.Item("note");
    note.libraryID = requiredNumber(parent.libraryID, "library ID");
    note.parentID = requiredNumber(parent.id, "parent item ID");
    note.setNote?.(input.content);
    note.addRelation(OPERATION_RELATION_PREDICATE, input.operationMarker);
    this.#assertMutationEnabled();
    await note.saveTx({ skipSelect: true });
    const record = await this.getNote(
      input.libraryId,
      input.itemKey,
      requiredString(note.key, "note key"),
    );
    if (record === undefined) throw new Error("The committed native child note could not be reloaded");
    return record;
  }

  async updateNote(input: NativeNoteUpdate): Promise<NativeNoteRecord> {
    const parent = await this.#fresh(input.expected.libraryId, input.expected.itemKey);
    const note = await this.#fresh(input.expected.libraryId, input.expected.noteKey);
    if (
      parent === undefined ||
      !parent.isRegularItem() ||
      note === undefined ||
      !note.isNote() ||
      note.parentItemID !== parent.id
    ) {
      throw new CoreOperationError("not_found", "The child note was not found");
    }
    const current = await this.#noteRecord(note, parent);
    if (noteMaterial(current) !== noteMaterial(input.expected)) {
      throw new CoreOperationError(
        "conflict",
        "The native child note changed after authorization; reread it before updating",
      );
    }
    if (!note.isEditable()) {
      throw new CoreOperationError("permission_denied", "The child note is not editable");
    }
    note.setNote?.(input.content);
    note.addRelation(OPERATION_RELATION_PREDICATE, input.operationMarker);
    this.#assertMutationEnabled();
    await note.saveTx({ skipSelect: true });
    const record = await this.getNote(
      input.expected.libraryId,
      input.expected.itemKey,
      input.expected.noteKey,
    );
    if (record === undefined) throw new Error("The updated native child note could not be reloaded");
    return record;
  }

  async annotationVisible(
    requestedLibraryId: string,
    attachmentKey: string,
    annotationKey: string,
  ): Promise<boolean> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment() || attachment.id === undefined) {
      return false;
    }
    if (!/^[A-Za-z0-9]+$/u.test(annotationKey)) return false;
    const record = await this.getAnnotation(requestedLibraryId, attachmentKey, annotationKey);
    if (record === undefined) return false;
    return (
      (await this.#withReader(attachment.id, false, async (reader, view) => {
        const internal = reader._internalReader;
        const readerDocument = reader._iframeWindow?.document;
        const sidebar = readerDocument?.querySelector(
          `[data-sidebar-annotation-id="${annotationKey}"]`,
        );
        const commentMatches = (
          node: QueryNodeLike | null | undefined,
          document: QueryDocumentLike | undefined,
        ): boolean => {
          if (!isRenderedNode(node, document)) return false;
          if (record.comment.length === 0) return true;
          const content = node.querySelector?.(".comment .content");
          return (
            isRenderedNode(content, document) &&
            content.textContent?.trim() === record.comment.trim()
          );
        };
        if (
          internal?._state?.sidebarOpen === true &&
          internal._state.sidebarView === "annotations" &&
          commentMatches(sidebar, readerDocument)
        ) {
          return true;
        }

        const selected = internal?._state?.selectedAnnotationIDs;
        if (
          Array.isArray(selected) &&
          selected.includes(annotationKey) &&
          commentMatches(readerDocument?.querySelector(".annotation-popup"), readerDocument)
        ) {
          return true;
        }

        if (record.comment.length > 0) return false;
        const viewDocument = view._iframeWindow?.document;
        return isRenderedNode(
          viewDocument?.querySelector(`[data-annotation-id="${annotationKey}"]`),
          viewDocument,
        );
      })) ?? false
    );
  }

  async findByOperationMarker(marker: string): Promise<NativeMutationRecord[]> {
    const values = await this.#zotero.Relations.getByPredicateAndObject(
      "item",
      OPERATION_RELATION_PREDICATE,
      marker,
    );
    const records: NativeMutationRecord[] = [];
    for (const value of values) {
      const key = value.key;
      const id = value.libraryID;
      if (key === undefined || id === undefined) continue;
      const fresh = await this.#fresh(String(id), key);
      if (fresh === undefined || fresh.deleted === true) continue;
      if (fresh.isAnnotation()) {
        const attachmentId = fresh.parentItemID;
        if (typeof attachmentId !== "number") continue;
        const attachmentValue = await this.#zotero.Items.getAsync(attachmentId, { noCache: true });
        if (Array.isArray(attachmentValue) || !attachmentValue || !attachmentValue.isPDFAttachment()) {
          continue;
        }
        const record = await this.#annotationRecord(fresh, attachmentValue);
        if (record !== undefined) records.push(record);
      } else if (fresh.isNote()) {
        const parentId = fresh.parentItemID;
        if (typeof parentId !== "number") continue;
        const parentValue = await this.#zotero.Items.getAsync(parentId, { noCache: true });
        if (Array.isArray(parentValue) || !parentValue || !parentValue.isRegularItem()) continue;
        records.push(await this.#noteRecord(fresh, parentValue));
      }
    }
    return records;
  }

  async #fresh(requestedLibraryId: string, key: string): Promise<ZoteroItemLike | undefined> {
    const value = await this.#zotero.Items.getByLibraryAndKeyAsync(
      libraryId(requestedLibraryId),
      key,
      { noCache: true },
    );
    return value || undefined;
  }

  async #parentRecord(attachment: ZoteroItemLike): Promise<ZoteroItemLike | undefined> {
    if (typeof attachment.parentItemID !== "number") return undefined;
    const value = await this.#zotero.Items.getAsync(attachment.parentItemID, { noCache: true });
    return Array.isArray(value) || !value ? undefined : value;
  }

  async #fingerprint(item: ZoteroItemLike): Promise<string> {
    const path = await item.getFilePathAsync();
    if (typeof path !== "string" || path.length === 0) {
      throw new CoreOperationError("not_found", "The PDF attachment file is unavailable");
    }
    const bytes = await this.#io.read(path);
    return this.#fingerprintBytes(bytes);
  }

  async #readerFingerprint(document: PdfDocumentLike): Promise<string> {
    if (document.getData === undefined) {
      throw new CoreOperationError(
        "stale_attachment",
        "The open Zotero reader cannot verify its loaded PDF bytes; reload the reader and retry",
      );
    }
    let bytes: Uint8Array | ArrayBuffer;
    try {
      bytes = await document.getData();
    } catch {
      throw new CoreOperationError(
        "stale_attachment",
        "The open Zotero reader could not verify its loaded PDF bytes; reload the reader and retry",
      );
    }
    return this.#fingerprintBytes(bytes);
  }

  async #fingerprintBytes(bytes: Uint8Array | ArrayBuffer): Promise<string> {
    const source = bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes);
    const digest = await this.#crypto.subtle.digest("SHA-256", source);
    return `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  async #digestText(value: string): Promise<string> {
    const digest = await this.#crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  async #withReader<T>(
    itemId: number,
    openIfMissing: boolean,
    work: (reader: ReaderLike, view: ReaderPrimaryViewLike) => Promise<T> | T,
  ): Promise<T | undefined>;
  async #withReader<T>(
    itemId: number,
    openIfMissing: true,
    work: (reader: ReaderLike, view: ReaderPrimaryViewLike) => Promise<T> | T,
  ): Promise<T>;
  async #withReader<T>(
    itemId: number,
    openIfMissing: boolean,
    work: (reader: ReaderLike, view: ReaderPrimaryViewLike) => Promise<T> | T,
  ): Promise<T | undefined> {
    const prior = this.#zotero.Reader._readers.find((candidate) => candidate.itemID === itemId);
    if (prior === undefined && !openIfMissing) return undefined;
    let reader = prior;
    let openedByAdapter = false;
    if (reader === undefined) {
      const before = new Set(this.#zotero.Reader._readers);
      reader = await this.#zotero.Reader.open(itemId, null, {
        openInBackground: true,
        allowDuplicate: false,
      });
      for (let attempt = 0; reader === undefined && attempt < 40; attempt += 1) {
        await this.#delay(25);
        reader = this.#zotero.Reader._readers.find((candidate) => candidate.itemID === itemId);
      }
      openedByAdapter = reader !== undefined && !before.has(reader);
    }
    if (reader === undefined) throw new Error("Zotero did not initialize a reader for the PDF");
    try {
      await reader._initPromise;
      const view = reader._internalReader?._primaryView;
      if (view === undefined) throw new Error("The initialized Zotero reader has no primary view");
      await view.initializedPromise;
      return await work(reader, view);
    } finally {
      if (openedByAdapter) reader.close?.();
    }
  }

  async #delay(milliseconds: number): Promise<void> {
    if (this.#zotero.Promise?.delay !== undefined) {
      await this.#zotero.Promise.delay(milliseconds);
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }

  #assertMutationEnabled(): void {
    if (this.#accessGate !== undefined && !this.#accessGate.isEnabled()) {
      throw new CoreOperationError(
        "permission_denied",
        "Zotero companion access was disabled before native commit",
      );
    }
  }

  async #annotationRecord(
    item: ZoteroItemLike,
    attachment: ZoteroItemLike,
  ): Promise<NativeAnnotationRecord | undefined> {
    await item.loadAllData?.();
    const nativeType = item.annotationType;
    if (nativeType !== "highlight" && nativeType !== "note") return undefined;
    const position = parsePosition(item);
    const parent = await this.#parentRecord(attachment);
    const library = requiredNumber(item.libraryID, "library ID");
    const annotationKey = requiredString(item.key, "annotation key");
    const attachmentKey = requiredString(attachment.key, "attachment key");
    const prefix = this.#zotero.API.getLibraryPrefix(library);
    return {
      libraryId: String(library),
      itemKey: requiredString(parent?.key ?? attachment.key, "parent item key"),
      attachmentKey,
      annotationKey,
      type: nativeType,
      ...(nativeType === "highlight" && typeof item.annotationText === "string"
        ? { text: item.annotationText }
        : {}),
      comment: item.annotationComment ?? "",
      ...(optionalString(item.annotationColor) === undefined ? {} : { color: item.annotationColor }),
      pageIndex: position.pageIndex,
      pageLabel: item.annotationPageLabel ?? String(position.pageIndex + 1),
      rectangles: position.rectangles,
      version: item.version ?? 0,
      dateModified: item.dateModified ?? "",
      operationMarkers: [...item.getRelationsByPredicate(OPERATION_RELATION_PREDICATE)],
      deepLink:
        `zotero://open-pdf/${prefix}/items/${encodeURIComponent(attachmentKey)}` +
        `?page=${position.pageIndex + 1}&annotation=${encodeURIComponent(annotationKey)}`,
    };
  }

  async #noteRecord(item: ZoteroItemLike, parent: ZoteroItemLike): Promise<NativeNoteRecord> {
    await item.loadAllData?.();
    const library = requiredNumber(item.libraryID, "library ID");
    const noteKey = requiredString(item.key, "note key");
    const prefix = this.#zotero.API.getLibraryPrefix(library);
    return {
      libraryId: String(library),
      itemKey: requiredString(parent.key, "parent item key"),
      noteKey,
      title: item.getNoteTitle?.() ?? "",
      content: item.getNote?.() ?? "",
      version: item.version ?? 0,
      dateModified: item.dateModified ?? "",
      operationMarkers: [...item.getRelationsByPredicate(OPERATION_RELATION_PREDICATE)],
      deepLink: `zotero://select/${prefix}/items/${encodeURIComponent(noteKey)}`,
    };
  }
}

export function createZoteroNativeApi(environment: ZoteroNativeEnvironment): ZoteroNativeApi {
  return new ZoteroGlobalNativeApi(environment);
}
