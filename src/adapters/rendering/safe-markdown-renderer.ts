import createDOMPurify, { type DOMPurify, type WindowLike } from "dompurify";
import katex from "katex";
import MarkdownIt, {
  type MarkdownIt as MarkdownItInstance,
  type StateInline,
  type Token,
} from "markdown-it";

import type {
  SafeRenderedContent,
  UntrustedContentRenderingPort,
  UntrustedRenderInput,
} from "../../ports/rendering.js";

interface MarkdownEngine {
  render(source: string): string;
}

export interface SafeMarkdownRendererOptions {
  window: WindowLike;
  /** Test seam and replacement port for a compatible Markdown implementation. */
  markdown?: MarkdownEngine;
}

const SAFE_HTML_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

// KaTeX's MathML-only output uses this bounded set. SVG and HTML style
// attributes are deliberately absent so formulas cannot initiate resource loads.
const SAFE_MATHML_TAGS = [
  "annotation",
  "math",
  "menclose",
  "merror",
  "mfrac",
  "mi",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "mlabeledtr",
  "munder",
  "munderover",
  "none",
  "semantics",
] as const;

const SAFE_HTML_ATTRIBUTES = [
  "aria-label",
  "class",
  "href",
  "rel",
  "role",
  "title",
] as const;

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const MATHML_LENGTH = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:em|ex|px|pt|pc|in|cm|mm|mu|%|width)?$/iu;
const MATHML_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{1,32})$/iu;
const MATHML_BOOLEAN = /^(?:true|false)$/u;

function oneOf(...values: string[]): (value: string) => boolean {
  const allowed = new Set(values);
  return (value) => allowed.has(value);
}

function tokenList(...values: string[]): (value: string) => boolean {
  const allowed = new Set(values);
  return (value) => value.length > 0 && value.split(" ").every((token) => allowed.has(token));
}

function lengthList(value: string): boolean {
  return value.length > 0 && value.split(" ").every((token) => MATHML_LENGTH.test(token));
}

const SAFE_MATHML_ATTRIBUTES: Readonly<Record<string, (value: string) => boolean>> = {
  accent: (value) => MATHML_BOOLEAN.test(value),
  accentunder: (value) => MATHML_BOOLEAN.test(value),
  columnalign: tokenList("left", "center", "right"),
  columnlines: tokenList("none", "solid", "dashed"),
  columnspacing: lengthList,
  columnspan: (value) => /^[1-9]\d{0,2}$/u.test(value),
  depth: (value) => MATHML_LENGTH.test(value),
  display: oneOf("block", "inline"),
  displaystyle: (value) => MATHML_BOOLEAN.test(value),
  encoding: oneOf("application/x-tex"),
  fence: (value) => MATHML_BOOLEAN.test(value),
  height: (value) => MATHML_LENGTH.test(value),
  largeop: (value) => MATHML_BOOLEAN.test(value),
  linebreak: oneOf("auto", "newline", "nobreak", "goodbreak", "badbreak"),
  linethickness: (value) => MATHML_LENGTH.test(value) || ["thin", "medium", "thick"].includes(value),
  lspace: (value) => MATHML_LENGTH.test(value),
  mathbackground: (value) => MATHML_COLOR.test(value),
  mathcolor: (value) => MATHML_COLOR.test(value),
  mathsize: (value) => MATHML_LENGTH.test(value),
  mathvariant: oneOf(
    "normal",
    "bold",
    "italic",
    "bold-italic",
    "double-struck",
    "bold-fraktur",
    "script",
    "bold-script",
    "fraktur",
    "sans-serif",
    "bold-sans-serif",
    "sans-serif-italic",
    "sans-serif-bold-italic",
    "monospace",
    "initial",
    "tailed",
    "looped",
    "stretched",
  ),
  maxsize: (value) => value === "infinity" || MATHML_LENGTH.test(value),
  minsize: (value) => MATHML_LENGTH.test(value),
  notation: tokenList(
    "actuarial",
    "box",
    "roundedbox",
    "circle",
    "left",
    "right",
    "top",
    "bottom",
    "updiagonalstrike",
    "downdiagonalstrike",
    "verticalstrike",
    "horizontalstrike",
    "phasorangle",
    "longdiv",
    "radical",
    "madruwb",
  ),
  rowalign: tokenList("top", "bottom", "center", "baseline", "axis"),
  rowlines: tokenList("none", "solid", "dashed"),
  rowspan: (value) => /^[1-9]\d{0,2}$/u.test(value),
  rowspacing: lengthList,
  rspace: (value) => MATHML_LENGTH.test(value),
  scriptlevel: (value) => /^[+-]?\d{1,3}$/u.test(value),
  separator: (value) => MATHML_BOOLEAN.test(value),
  stretchy: (value) => MATHML_BOOLEAN.test(value),
  valign: (value) => MATHML_LENGTH.test(value) || ["top", "middle", "bottom", "baseline", "axis"].includes(value),
  voffset: (value) => MATHML_LENGTH.test(value),
  width: (value) => MATHML_LENGTH.test(value),
  xmlns: oneOf(MATHML_NAMESPACE),
};

const SAFE_ATTRIBUTES = [...SAFE_HTML_ATTRIBUTES, ...Object.keys(SAFE_MATHML_ATTRIBUTES)];
const HTTP_URL = /^https?:\/\//iu;
const MAX_RENDER_SOURCE_LENGTH = 512 * 1024;
const MAX_MATH_DELIMITER_CANDIDATES = 4_096;
const MAX_MATH_EXPRESSION_LENGTH = 64 * 1024;

class RenderWorkBudgetExceeded extends Error {}

/**
 * Pure untrusted-comment renderer. It never reads Zotero state or mutates the
 * reader DOM; the reader adapter owns that separate lifecycle boundary.
 */
export class SafeMarkdownRenderer implements UntrustedContentRenderingPort {
  readonly #markdown: MarkdownEngine;
  readonly #purifier: DOMPurify;

  constructor(options: SafeMarkdownRendererOptions) {
    if (options.window.document === undefined) {
      throw new Error("SafeMarkdownRenderer requires a DOM window");
    }
    this.#markdown = options.markdown ?? createMarkdownEngine();
    this.#purifier = createDOMPurify(options.window);
    this.#purifier.addHook("uponSanitizeAttribute", (node, event) => {
      const name = event.attrName.toLowerCase();
      const mathMLValidator = SAFE_MATHML_ATTRIBUTES[name];
      if (mathMLValidator !== undefined) {
        if (node.namespaceURI === MATHML_NAMESPACE && mathMLValidator(event.attrValue)) {
          event.forceKeepAttr = true;
        } else {
          event.keepAttr = false;
        }
        return;
      }
      if (name === "href") {
        if (
          node.namespaceURI === HTML_NAMESPACE &&
          node.localName === "a" &&
          isSafeReferenceUrl(event.attrValue)
        ) {
          event.forceKeepAttr = true;
        } else {
          event.keepAttr = false;
        }
      } else if (name === "rel") {
        if (
          node.namespaceURI === HTML_NAMESPACE &&
          node.localName === "a" &&
          event.attrValue === "noopener noreferrer"
        ) {
          event.forceKeepAttr = true;
        } else {
          event.keepAttr = false;
        }
      }
    });
  }

  async render(input: UntrustedRenderInput): Promise<SafeRenderedContent> {
    if (input.requestedFormat === "plain_text") {
      return { content: input.content, format: "plain_text", untrusted: true };
    }

    const source = normalizeLineEndings(input.content);
    let generated: string;
    try {
      assertWithinRenderWorkBudget(source);
      generated = this.#markdown.render(source);
    } catch {
      generated = `<p>${escapeHtml(source).replaceAll("\n", "<br>")}</p>`;
    }

    const content = this.#purifier.sanitize(generated, {
      ALLOWED_TAGS: [...SAFE_HTML_TAGS, ...SAFE_MATHML_TAGS],
      ALLOWED_ATTR: SAFE_ATTRIBUTES,
      ALLOW_ARIA_ATTR: true,
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      ALLOWED_URI_REGEXP: HTTP_URL,
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
    });

    return { content, format: "sanitized_html", untrusted: true };
  }
}

function createMarkdownEngine(): MarkdownItInstance {
  const markdown = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
    typographer: false,
    maxNesting: 40,
  });

  markdown.disable("image");
  markdown.validateLink = isSafeReferenceUrl;
  installMathRules(markdown);

  const defaultLinkOpen = markdown.renderer.rules.link_open ??
    ((tokens, index, options, _env, renderer) => renderer.renderToken(tokens, index, options));
  markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
    const token = tokens[index];
    const href = token?.attrGet("href");
    if (typeof href !== "string" || !isSafeReferenceUrl(href)) {
      token?.attrSet("href", "");
    }
    token?.attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, index, options, environment, renderer);
  };

  return markdown;
}

function installMathRules(markdown: MarkdownItInstance): void {
  markdown.inline.ruler.before("escape", "zotero_math", mathInlineRule);
  markdown.renderer.rules.zotero_math = (tokens, index) => renderMathToken(tokens[index]);
}

function assertWithinRenderWorkBudget(source: string): void {
  if (source.length > MAX_RENDER_SOURCE_LENGTH) throw new RenderWorkBudgetExceeded();
  let delimiterCandidates = 0;
  let precedingBackslashes = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const escaped = precedingBackslashes % 2 === 1;
    if (
      !escaped &&
      (character === "$" ||
        (character === "\\" && (source[index + 1] === "[" || source[index + 1] === "(")))
    ) {
      delimiterCandidates += 1;
      if (delimiterCandidates > MAX_MATH_DELIMITER_CANDIDATES) {
        throw new RenderWorkBudgetExceeded();
      }
    }
    precedingBackslashes = character === "\\" ? precedingBackslashes + 1 : 0;
  }
}

interface MathScanState {
  closers: Map<string, Uint32Array>;
  escaped: Uint8Array;
  remainingWork: number;
}

const MATH_SCAN_STATES = new WeakMap<StateInline, MathScanState>();

function mathScanState(state: StateInline): MathScanState {
  const existing = MATH_SCAN_STATES.get(state);
  if (existing !== undefined) return existing;
  const source = state.src;
  const scan: MathScanState = {
    closers: new Map(),
    escaped: new Uint8Array(source.length),
    remainingWork: source.length * 6 + 64,
  };
  consumeMathWork(scan, source.length);
  let precedingBackslashes = 0;
  for (let index = 0; index < source.length; index += 1) {
    scan.escaped[index] = precedingBackslashes % 2;
    precedingBackslashes = source[index] === "\\" ? precedingBackslashes + 1 : 0;
  }
  MATH_SCAN_STATES.set(state, scan);
  return scan;
}

function consumeMathWork(scan: MathScanState, units: number): void {
  if (units > scan.remainingWork) throw new RenderWorkBudgetExceeded();
  scan.remainingWork -= units;
}

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const source = state.src;
  const start = state.pos;
  const delimiter = mathDelimiterAt(source, start);
  if (delimiter === undefined) return false;
  const scan = mathScanState(state);
  consumeMathWork(scan, 1);

  const contentStart = start + delimiter.open.length;
  const close = findClosingDelimiter(state, scan, contentStart, delimiter.close, delimiter.display);
  if (close < 0) return false;
  const content = source.slice(contentStart, close);
  if (content.trim().length === 0) return false;
  if (content.length > MAX_MATH_EXPRESSION_LENGTH) throw new RenderWorkBudgetExceeded();

  if (!silent) {
    const token = state.push("zotero_math", "math", 0);
    token.content = content;
    token.meta = { display: delimiter.display, open: delimiter.open, close: delimiter.close };
  }
  state.pos = close + delimiter.close.length;
  return true;
}

function mathDelimiterAt(
  source: string,
  position: number,
): { open: string; close: string; display: boolean } | undefined {
  if (source.startsWith("$$", position)) return { open: "$$", close: "$$", display: true };
  if (source.startsWith("\\[", position)) return { open: "\\[", close: "\\]", display: true };
  if (source.startsWith("\\(", position)) return { open: "\\(", close: "\\)", display: false };
  if (source[position] === "$") return { open: "$", close: "$", display: false };
  return undefined;
}

function findClosingDelimiter(
  state: StateInline,
  scan: MathScanState,
  from: number,
  close: string,
  display: boolean,
): number {
  const cacheKey = `${display ? "display" : "inline"}:${close}`;
  let positions = scan.closers.get(cacheKey);
  if (positions === undefined) {
    const source = state.src;
    consumeMathWork(scan, source.length);
    positions = new Uint32Array(source.length + 1);
    let next = 0;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      if (!display && source[index] === "\n") {
        next = 0;
      } else if (
        scan.escaped[index] === 0 &&
        source.startsWith(close, index) &&
        (close !== "$" || (source[index - 1] !== "$" && source[index + 1] !== "$"))
      ) {
        next = index + 1;
      }
      positions[index] = next;
    }
    scan.closers.set(cacheKey, positions);
  }
  const encoded = positions[from] ?? 0;
  return encoded === 0 ? -1 : encoded - 1;
}

function renderMathToken(token: Token | undefined): string {
  if (token === undefined) return "";
  const metadata = token.meta as { display?: unknown; open?: unknown; close?: unknown } | null;
  const displayMode = metadata?.display === true;
  try {
    const rendered = katex.renderToString(token.content, {
      displayMode,
      output: "mathml",
      throwOnError: true,
      strict: "error",
      trust: false,
      maxExpand: 1_000,
      maxSize: 20,
    });
    return displayMode ? `<span class="katex-display">${rendered}</span>` : rendered;
  } catch {
    const open = typeof metadata?.open === "string" ? metadata.open : "";
    const close = typeof metadata?.close === "string" ? metadata.close : "";
    return `<code class="math-source">${escapeHtml(`${open}${token.content}${close}`)}</code>`;
  }
}

export function isSafeReferenceUrl(value: string): boolean {
  if (!HTTP_URL.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
