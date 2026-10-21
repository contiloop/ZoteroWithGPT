import type {
  AnchorCandidate,
  RequestFor,
  ResolvedAnchor,
  ResolveAnchorResult,
} from "../protocol/types.js";
import type { OperationIdentity } from "./execution.js";

export interface AnchorResolutionPort {
  resolve(request: RequestFor<"resolve_anchor">): Promise<ResolveAnchorResult>;
}

export type AnchorRevalidationResult =
  | {
      status: "confirmed";
      anchor: ResolvedAnchor;
      description: string;
    }
  | { status: "unresolved"; reason: string }
  | { status: "ambiguous"; reason: string; candidates?: AnchorCandidate[] }
  | { status: "stale_attachment"; reason: string; actualFingerprint?: string };

/** Required immediately before a native annotation write. */
export interface AnchorRevalidationPort {
  revalidate(
    anchor: ResolvedAnchor,
    identity?: OperationIdentity,
  ): Promise<AnchorRevalidationResult>;
}
