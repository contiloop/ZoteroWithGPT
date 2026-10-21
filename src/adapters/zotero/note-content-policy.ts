import createDOMPurify, { type Config, type DOMPurify, type WindowLike } from "dompurify";

import type { NativeNoteContentPolicy } from "./native-api.js";

const SAFE_NOTE_TAGS = [
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "dd",
  "del",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
] as const;

const SAFE_NOTE_ATTRIBUTES = [
  "aria-label",
  "class",
  "colspan",
  "data-annotation",
  "data-citation",
  "data-colwidth",
  "data-schema-version",
  "dir",
  "href",
  "id",
  "lang",
  "rel",
  "reversed",
  "role",
  "rowspan",
  "scope",
  "start",
  "title",
  "value",
] as const;

const VOID_NOTE_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const STRIPPED_NATIVE_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const URL_WHITESPACE_OR_CONTROLS = /[\u0000-\u0020\u007F-\u009F]/u;
const SAFE_URI_PREFIX = /^(?:https?|zotero):\/\//iu;
const SAFE_ITEM_PATH = /^\/(?:library|groups\/[1-9][0-9]*)\/items\/[A-Za-z0-9]{1,64}$/u;
const SAFE_REL_TOKENS = new Set([
  "external",
  "nofollow",
  "noopener",
  "noreferrer",
  "sponsored",
  "ugc",
]);

/*
 * DOMPurify and the element-by-element readable fallback both walk the parsed
 * tree. Keep raw markup comfortably below native DOM recursion and work limits
 * while retaining the protocol's full allowance for ordinary plain text.
 */
const MAX_NOTE_DOM_DEPTH = 64;
const MAX_NOTE_DOM_ELEMENTS = 2_048;
const MAX_NOTE_TAG_CHARACTERS = 65_536;

const SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: [...SAFE_NOTE_TAGS],
  ALLOWED_ATTR: [...SAFE_NOTE_ATTRIBUTES],
  ALLOW_ARIA_ATTR: true,
  ALLOW_DATA_ATTR: true,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  FORBID_TAGS: [
    "audio",
    "embed",
    "form",
    "iframe",
    "img",
    "input",
    "link",
    "meta",
    "object",
    "picture",
    "script",
    "source",
    "style",
    "svg",
    "textarea",
    "video",
  ],
  FORBID_ATTR: [
    "action",
    "background",
    "formaction",
    "poster",
    "src",
    "srcdoc",
    "srcset",
    "style",
    "xlink:href",
  ],
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeZoteroItemUrl(parsed: URL): boolean {
  if (!SAFE_ITEM_PATH.test(parsed.pathname) || parsed.hash.length > 0) return false;
  if (parsed.hostname === "select") return parsed.search.length === 0;
  if (parsed.hostname !== "open-pdf") return false;
  const seen = new Set<string>();
  for (const [name, value] of parsed.searchParams) {
    if (seen.has(name) || (name !== "page" && name !== "annotation")) return false;
    seen.add(name);
    if (name === "page" && !/^[1-9][0-9]*$/u.test(value)) return false;
    if (name === "annotation" && !/^[A-Za-z0-9]{1,64}$/u.test(value)) return false;
  }
  return true;
}

export function isSafeNativeNoteReferenceUrl(value: string): boolean {
  if (
    !SAFE_URI_PREFIX.test(value) ||
    URL_WHITESPACE_OR_CONTROLS.test(value) ||
    value.trim() !== value
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname.length > 0;
    }
    return parsed.protocol === "zotero:" && safeZoteroItemUrl(parsed);
  } catch {
    return false;
  }
}

function tagEnd(content: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

function unambiguousAttributes(source: string): boolean {
  const names = new Set<string>();
  let cursor = 0;
  while (cursor < source.length) {
    while (/[\t\n\f\r ]/u.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) return true;
    const name = source.slice(cursor).match(/^[A-Za-z_:][A-Za-z0-9_.:-]*/u)?.[0];
    if (name === undefined || names.has(name.toLowerCase())) return false;
    names.add(name.toLowerCase());
    cursor += name.length;
    while (/[\t\n\f\r ]/u.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") continue;
    cursor += 1;
    while (/[\t\n\f\r ]/u.test(source[cursor] ?? "")) cursor += 1;
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, cursor + 1);
      if (end === -1 || source.slice(cursor + 1, end).includes("<")) return false;
      cursor = end + 1;
      if (cursor < source.length && !/[\t\n\f\r ]/u.test(source[cursor] ?? "")) return false;
      continue;
    }
    const start = cursor;
    while (cursor < source.length && !/[\t\n\f\r ]/u.test(source[cursor] ?? "")) {
      if (/['"=<>`]/u.test(source[cursor] ?? "")) return false;
      cursor += 1;
    }
    if (cursor === start) return false;
  }
  return true;
}

type NoteStructure = "safe" | "ambiguous" | "over_budget";

/** Rejects parser repairs and bounds tree work before untrusted content reaches a DOM. */
function inspectNoteStructure(content: string): NoteStructure {
  const openTags: string[] = [];
  let elements = 0;
  let tagCharacters = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf("<", cursor);
    if (start === -1) break;
    const end = tagEnd(content, start);
    if (end === -1) return "ambiguous";
    tagCharacters += end - start + 1;
    if (tagCharacters > MAX_NOTE_TAG_CHARACTERS) return "over_budget";
    const raw = content.slice(start, end + 1);
    const closing = raw.match(/^<\s*\/\s*([A-Za-z][A-Za-z0-9]*)\s*>$/u);
    if (closing !== null) {
      const name = closing[1]!.toLowerCase();
      if (VOID_NOTE_TAGS.has(name) || openTags.pop() !== name) return "ambiguous";
      cursor = end + 1;
      continue;
    }
    const opening = raw.match(/^<\s*([A-Za-z][A-Za-z0-9]*)/u);
    if (opening === null) return "ambiguous";
    elements += 1;
    if (elements > MAX_NOTE_DOM_ELEMENTS) return "over_budget";
    const name = opening[1]!.toLowerCase();
    let attributes = raw.slice(opening[0].length, -1);
    if (attributes.length > 0 && !/^[\t\n\f\r /]/u.test(attributes)) return "ambiguous";
    attributes = attributes.replace(/[\t\n\f\r ]+$/u, "");
    const selfClosing = attributes.endsWith("/");
    if (selfClosing) attributes = attributes.slice(0, -1);
    if (!unambiguousAttributes(attributes) || (selfClosing && !VOID_NOTE_TAGS.has(name))) {
      return "ambiguous";
    }
    if (!selfClosing && !VOID_NOTE_TAGS.has(name)) {
      openTags.push(name);
      if (openTags.length > MAX_NOTE_DOM_DEPTH) return "over_budget";
    }
    cursor = end + 1;
  }
  return openTags.length === 0 ? "safe" : "ambiguous";
}

export interface DomPurifyNativeNoteContentPolicyOptions {
  window: WindowLike;
}

function detachedHtmlWindow(window: WindowLike, document: Document): WindowLike {
  return {
    document,
    DocumentFragment: window.DocumentFragment,
    HTMLTemplateElement: window.HTMLTemplateElement,
    Node: window.Node,
    Element: window.Element,
    NodeFilter: window.NodeFilter,
    NamedNodeMap: window.NamedNodeMap,
    HTMLFormElement: window.HTMLFormElement,
    DOMParser: window.DOMParser,
    trustedTypes: window.trustedTypes,
  };
}

/** DOM-backed note HTML policy used by both protocol and privileged adapters. */
export class DomPurifyNativeNoteContentPolicy implements NativeNoteContentPolicy {
  readonly #document: Document;
  readonly #purifier: DOMPurify;

  constructor(options: DomPurifyNativeNoteContentPolicyOptions) {
    const ownerDocument = options.window.document;
    const document = ownerDocument?.implementation?.createHTMLDocument("");
    if (
      document === undefined ||
      document.documentElement?.namespaceURI !== HTML_NAMESPACE ||
      document.body === null
    ) {
      throw new Error("Native note content policy requires a trusted Zotero DOM window");
    }
    this.#document = document;
    this.#purifier = createDOMPurify(detachedHtmlWindow(options.window, document));
    if (!this.#purifier.isSupported) {
      throw new Error("Native note content policy requires a trusted Zotero HTML implementation");
    }
    this.#purifier.addHook("uponSanitizeAttribute", (node, event) => {
      const name = event.attrName.toLowerCase();
      if (name === "href") {
        if (
          node.namespaceURI === HTML_NAMESPACE &&
          node.localName === "a" &&
          isSafeNativeNoteReferenceUrl(event.attrValue)
        ) {
          event.forceKeepAttr = true;
        } else {
          event.keepAttr = false;
        }
        return;
      }
      if (name === "rel") {
        const tokens = event.attrValue.toLowerCase().split(/[\t\n\f\r ]+/u).filter(Boolean);
        if (
          node.namespaceURI !== HTML_NAMESPACE ||
          node.localName !== "a" ||
          tokens.length === 0 ||
          tokens.some((token) => !SAFE_REL_TOKENS.has(token))
        ) {
          event.keepAttr = false;
        }
        return;
      }
      if (
        name === "class" &&
        event.attrValue.split(/[\t\n\f\r ]+/u).some((token) => token.toLowerCase() === "zotero-note")
      ) {
        event.keepAttr = false;
      } else if ((name === "colspan" || name === "rowspan") && !/^[1-9][0-9]{0,2}$/u.test(event.attrValue)) {
        event.keepAttr = false;
      } else if (name === "data-colwidth" && !/^[1-9][0-9]*(?:,[1-9][0-9]*)*$/u.test(event.attrValue)) {
        event.keepAttr = false;
      }
    });
  }

  sanitize(content: string): string {
    if (inspectNoteStructure(content) !== "safe") {
      return `<pre class="research-companion-note-source">${escapeHtml(content)}</pre>`;
    }
    const template = this.#template(content);
    this.#neutralizeUnsafeElements(template.content);
    const candidate = template.innerHTML;
    const sanitized = this.#sanitized(candidate);
    if (sanitized !== this.#normalize(candidate)) {
      return `<pre class="research-companion-note-source">${escapeHtml(content)}</pre>`;
    }
    const safeTemplate = this.#template(sanitized);
    for (const link of safeTemplate.content.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href");
      if (href !== null && /^https?:\/\//iu.test(href)) {
        link.setAttribute("rel", "noopener noreferrer");
      }
    }
    return safeTemplate.innerHTML;
  }

  accepts(content: string): boolean {
    return (
      content.trim() === content &&
      !STRIPPED_NATIVE_CONTROLS.test(content) &&
      inspectNoteStructure(content) === "safe" &&
      this.#sanitized(content) === this.#normalize(content)
    );
  }

  #sanitized(content: string): string {
    return this.#normalize(String(this.#purifier.sanitize(content, SANITIZE_CONFIG)));
  }

  #neutralizeUnsafeElements(parent: ParentNode): void {
    for (const element of Array.from(parent.children)) {
      if (!this.#acceptsElement(element)) {
        element.replaceWith(this.#document.createTextNode(element.outerHTML));
      } else {
        this.#neutralizeUnsafeElements(element);
      }
    }
  }

  #acceptsElement(element: Element): boolean {
    const clone = element.cloneNode(false) as Element;
    const before = clone.outerHTML;
    try {
      this.#purifier.sanitize(clone, { ...SANITIZE_CONFIG, IN_PLACE: true });
      return clone.outerHTML === before;
    } catch {
      return false;
    }
  }

  #normalize(content: string): string {
    return this.#template(content).innerHTML;
  }

  #template(content: string): HTMLTemplateElement {
    const template = this.#document.createElement("template");
    template.innerHTML = content;
    return template;
  }
}
