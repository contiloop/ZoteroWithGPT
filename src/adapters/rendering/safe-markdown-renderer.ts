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
  "munder",
  "munderover",
  "none",
  "semantics",
] as const;

const SAFE_ATTRIBUTES = [
  "aria-label",
  "class",
  "columnalign",
  "columnspacing",
  "columnspan",
  "display",
  "encoding",
  "href",
  "mathvariant",
  "rel",
  "role",
  "rowalign",
  "rowspan",
  "title",
  "xmlns",
] as const;

const HTTP_URL = /^https?:\/\//iu;

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
    this.#purifier.addHook("uponSanitizeAttribute", (_node, event) => {
      const name = event.attrName.toLowerCase();
      if (name === "href" && !isSafeReferenceUrl(event.attrValue)) {
        event.keepAttr = false;
      } else if (name === "rel" && event.attrValue === "noopener noreferrer") {
        event.forceKeepAttr = true;
      } else if (name === "display" && ["block", "inline"].includes(event.attrValue)) {
        event.forceKeepAttr = true;
      } else if (name === "encoding" && event.attrValue === "application/x-tex") {
        event.forceKeepAttr = true;
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
      generated = this.#markdown.render(source);
    } catch {
      generated = `<p>${escapeHtml(source).replaceAll("\n", "<br>")}</p>`;
    }

    const content = this.#purifier.sanitize(generated, {
      ALLOWED_TAGS: [...SAFE_HTML_TAGS, ...SAFE_MATHML_TAGS],
      ALLOWED_ATTR: [...SAFE_ATTRIBUTES],
      ADD_ATTR: ["display", "encoding"],
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

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const source = state.src;
  const start = state.pos;
  const delimiter = mathDelimiterAt(source, start);
  if (delimiter === undefined) return false;

  const contentStart = start + delimiter.open.length;
  const close = findClosingDelimiter(source, contentStart, delimiter.close, delimiter.display);
  if (close < 0) return false;
  const content = source.slice(contentStart, close);
  if (content.trim().length === 0) return false;

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
  source: string,
  from: number,
  close: string,
  display: boolean,
): number {
  for (let index = from; index <= source.length - close.length; index += 1) {
    if (!display && source[index] === "\n") return -1;
    if (!source.startsWith(close, index) || isEscaped(source, index)) continue;
    if (close === "$" && (source[index - 1] === "$" || source[index + 1] === "$")) continue;
    return index;
  }
  return -1;
}

function isEscaped(source: string, position: number): boolean {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
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
