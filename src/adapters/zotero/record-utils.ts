import type { PayloadDigestPort } from "../../ports/digest.js";
import type { OperationIdentity } from "../../ports/execution.js";
import { canonicalizeJson } from "../../protocol/canonical.js";
import type { NativeAnnotationRecord, NativeNoteRecord } from "./native-api.js";

export const OPERATION_RELATION_PREDICATE = "zotero:researchCompanionOperation";

const encoder = new TextEncoder();
const SAFE_NOTE_CONTAINER_OPEN = '<div class="research-companion-note">';
const SAFE_NOTE_CONTAINER_CLOSE = "</div>";
const SAFE_NOTE_ELEMENTS = new Set([
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
]);
const VOID_NOTE_ELEMENTS = new Set(["br", "hr", "wbr"]);
const ZOTERO_STRIPPED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

export function operationIdentityMarker(identity: OperationIdentity): string {
  return (
    "urn:zotero-ai-research-companion:operation:" +
    `${encodeURIComponent(identity.operationId)}:${encodeURIComponent(identity.requestDigest)}`
  );
}

export async function annotationRevision(
  record: NativeAnnotationRecord,
  digest: PayloadDigestPort,
): Promise<string> {
  const canonical = canonicalizeJson({
    kind: "annotation",
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
  return digest.digest(encoder.encode(canonical));
}

export async function noteRevision(
  record: NativeNoteRecord,
  digest: PayloadDigestPort,
): Promise<string> {
  const canonical = canonicalizeJson({
    kind: "note",
    libraryId: record.libraryId,
    itemKey: record.itemKey,
    noteKey: record.noteKey,
    title: record.title,
    content: record.content,
    version: record.version,
    dateModified: record.dateModified,
    operationMarkers: [...record.operationMarkers].sort(),
  });
  return digest.digest(encoder.encode(canonical));
}

export function annotationDeepLink(record: NativeAnnotationRecord): string {
  return (
    record.deepLink ??
    `zotero://open-pdf/library/items/${encodeURIComponent(record.attachmentKey)}` +
      `?page=${record.pageIndex + 1}&annotation=${encodeURIComponent(record.annotationKey)}`
  );
}

export function noteDeepLink(record: NativeNoteRecord): string {
  return record.deepLink ?? `zotero://select/library/items/${encodeURIComponent(record.noteKey)}`;
}

export function nativeNoteContent(content: string): string {
  const wrapper = content.match(
    /^<div class="zotero-note znv[0-9]+">([\s\S]*)<\/div>$/u,
  );
  return wrapper?.[1] ?? content;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function noteTagEnd(content: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function safeNoteTag(raw: string): string | undefined {
  if (raw.includes("<", 1)) return undefined;
  const closing = raw.match(/^<\s*\/\s*([A-Za-z][A-Za-z0-9]*)\s*>$/u);
  if (closing !== null) {
    const name = closing[1]!.toLowerCase();
    return SAFE_NOTE_ELEMENTS.has(name) && !VOID_NOTE_ELEMENTS.has(name)
      ? `</${name}>`
      : undefined;
  }
  const opening = raw.match(/^<\s*([A-Za-z][A-Za-z0-9]*)(?:\s[^<>]*)?\s*\/?>$/u);
  if (opening === null) return undefined;
  const name = opening[1]!.toLowerCase();
  if (!SAFE_NOTE_ELEMENTS.has(name)) return undefined;
  return `<${name}>`;
}

function unwrapSafeNoteContainer(content: string): string {
  return content.startsWith(SAFE_NOTE_CONTAINER_OPEN) &&
    content.endsWith(SAFE_NOTE_CONTAINER_CLOSE)
    ? content.slice(SAFE_NOTE_CONTAINER_OPEN.length, -SAFE_NOTE_CONTAINER_CLOSE.length)
    : content;
}

function sanitizeNativeNoteFragment(content: string): string {
  const source = unwrapSafeNoteContainer(nativeNoteContent(content)).replace(
    ZOTERO_STRIPPED_CONTROL_CHARACTERS,
    "\uFFFD",
  );
  let output = "";
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start === -1) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, start);
    const end = noteTagEnd(source, start);
    if (end === -1) {
      output += escapeHtml(source.slice(start));
      break;
    }
    const raw = source.slice(start, end + 1);
    output += safeNoteTag(raw) ?? escapeHtml(raw);
    cursor = end + 1;
  }
  return output;
}

function preserveBoundaryWhitespace(content: string): string {
  return content.trim() === content
    ? content
    : `${SAFE_NOTE_CONTAINER_OPEN}${content}${SAFE_NOTE_CONTAINER_CLOSE}`;
}

/**
 * Produces native editable note HTML without executable or resource-loading
 * elements. Unsupported markup remains visible as escaped text so study
 * content is not silently discarded.
 */
export function safeNativeNoteContent(content: string): string {
  return preserveBoundaryWhitespace(sanitizeNativeNoteFragment(content));
}

export function appendNoteContent(current: string, addition: string): string {
  const currentBody = sanitizeNativeNoteFragment(current);
  const additionBody = sanitizeNativeNoteFragment(addition);
  if (currentBody.length === 0) return preserveBoundaryWhitespace(additionBody);
  if (additionBody.length === 0) return preserveBoundaryWhitespace(currentBody);
  return preserveBoundaryWhitespace(`${currentBody}\n\n${additionBody}`);
}
