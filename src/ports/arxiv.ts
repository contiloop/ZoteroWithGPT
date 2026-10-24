import type { ArxivCandidate } from "../protocol/types.js";

/** Pre-cut import journal reconciliation inspects the original personal library. */
export interface ArxivNativeInspection {
  libraryId: string;
  candidates: ArxivCandidate[];
}
