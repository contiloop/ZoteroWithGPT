import type { PayloadDigestPort } from "../../ports/digest.js";
import type { OperationIdentity } from "../../ports/execution.js";
import type { ArticleIdentity } from "../../protocol/types.js";
import { canonicalizeJson } from "../../protocol/canonical.js";
import type {
  NativeAnnotationRecord,
  NativeNoteContentPolicy,
  NativeNoteRecord,
} from "./native-api.js";

export const OPERATION_RELATION_PREDICATE = "zotero:researchCompanionOperation";
export const ARXIV_PROVENANCE_RELATION_PREDICATE =
  "zotero:researchCompanionArxivProvenance";

const encoder = new TextEncoder();
const SAFE_NOTE_CONTAINER_OPEN = '<div class="research-companion-note">';
const SAFE_NOTE_CONTAINER_CLOSE = "</div>";
const ZOTERO_STRIPPED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

export function operationIdentityMarker(identity: OperationIdentity): string {
  return (
    "urn:zotero-ai-research-companion:operation:" +
    `${encodeURIComponent(identity.operationId)}:${encodeURIComponent(identity.requestDigest)}`
  );
}

export function arxivParentProvenance(source: ArticleIdentity): string {
  return (
    "urn:zotero-ai-research-companion:arxiv-parent:" +
    `${encodeURIComponent(source.arxivId)}:v${String(source.version)}`
  );
}

export function arxivAttachmentProvenance(
  source: ArticleIdentity,
  fingerprint: string,
): string {
  return (
    "urn:zotero-ai-research-companion:arxiv-pdf:" +
    `${encodeURIComponent(source.arxivId)}:v${String(source.version)}:` +
    encodeURIComponent(fingerprint)
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

function unwrapSafeNoteContainer(content: string): string {
  return content.startsWith(SAFE_NOTE_CONTAINER_OPEN) &&
    content.endsWith(SAFE_NOTE_CONTAINER_CLOSE)
    ? content.slice(SAFE_NOTE_CONTAINER_OPEN.length, -SAFE_NOTE_CONTAINER_CLOSE.length)
    : content;
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
export function safeNativeNoteContent(
  content: string,
  policy: NativeNoteContentPolicy,
): string {
  const source = unwrapSafeNoteContainer(nativeNoteContent(content)).replace(
    ZOTERO_STRIPPED_CONTROL_CHARACTERS,
    "\uFFFD",
  );
  return preserveBoundaryWhitespace(policy.sanitize(source));
}

export function isSafeNativeNoteContent(
  content: string,
  policy: NativeNoteContentPolicy,
): boolean {
  return nativeNoteContent(content) === content && policy.accepts(content);
}

export function appendNoteContent(
  current: string,
  addition: string,
  policy: NativeNoteContentPolicy,
): string {
  const additionBody = safeNativeNoteContent(addition, policy);
  if (current.length === 0) return additionBody;
  if (additionBody.length === 0) return current;
  return `${current}\n\n${additionBody}`;
}
