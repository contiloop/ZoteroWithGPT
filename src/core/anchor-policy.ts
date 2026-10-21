import type { AnchorRevalidationPort } from "../ports/anchor.js";
import type { OperationIdentity } from "../ports/execution.js";
import type { RequestFor, ResolvedAnchor } from "../protocol/types.js";
import { CoreOperationError } from "./errors.js";

export type AnchorWriteCheck =
  | { ok: true; anchor: ResolvedAnchor; description: string }
  | { ok: false; error: CoreOperationError };

/**
 * Makes anchor revalidation an unavoidable explicit step for annotation writes.
 * Ambiguity is unresolved; the core never chooses candidate geometry.
 */
export async function revalidateAnnotationAnchor(
  request: RequestFor<"create_annotation">,
  port: AnchorRevalidationPort,
  identity?: OperationIdentity,
): Promise<AnchorWriteCheck> {
  const result = await port.revalidate(request.payload.anchor, identity);
  if (result.status === "stale_attachment") {
    return {
      ok: false,
      error: new CoreOperationError("stale_attachment", result.reason),
    };
  }
  if (result.status === "unresolved" || result.status === "ambiguous") {
    return {
      ok: false,
      error: new CoreOperationError("unresolved_anchor", result.reason),
    };
  }

  const requested = request.payload.anchor;
  const confirmed = result.anchor;
  if (
    confirmed.libraryId !== requested.libraryId ||
    confirmed.itemKey !== requested.itemKey ||
    confirmed.attachmentKey !== requested.attachmentKey ||
    confirmed.pageIndex !== requested.pageIndex ||
    confirmed.selectedText !== requested.selectedText ||
    confirmed.matchEvidence.matchedText !== requested.matchEvidence.matchedText
  ) {
    return {
      ok: false,
      error: new CoreOperationError(
        "unresolved_anchor",
        "Anchor revalidation returned a different target or passage",
      ),
    };
  }
  if (confirmed.attachmentFingerprint !== requested.attachmentFingerprint) {
    return {
      ok: false,
      error: new CoreOperationError(
        "stale_attachment",
        "The PDF fingerprint changed and the anchor must be resolved again",
      ),
    };
  }
  return { ok: true, anchor: confirmed, description: result.description };
}
