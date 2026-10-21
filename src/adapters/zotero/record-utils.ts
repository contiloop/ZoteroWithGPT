import type { PayloadDigestPort } from "../../ports/digest.js";
import type { OperationIdentity } from "../../ports/execution.js";
import { canonicalizeJson } from "../../protocol/canonical.js";
import type { NativeAnnotationRecord, NativeNoteRecord } from "./native-api.js";

export const OPERATION_RELATION_PREDICATE = "zotero:researchCompanionOperation";

const encoder = new TextEncoder();

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

export function appendNoteContent(current: string, addition: string): string {
  const body = nativeNoteContent(addition);
  if (current.length === 0) return body;
  if (body.length === 0) return current;
  return `${current}\n\n${body}`;
}
