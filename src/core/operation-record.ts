import type {
  ArxivCandidate,
  ArxivSource,
  EnsureArxivPdfResult,
  ImportSelection,
  MutationOperationName,
  OperationName,
  OperationState,
  ProtocolResponse,
} from "../protocol/types.js";

export type ArxivImportRecoveryStage =
  | "prepared"
  | "parent_committed"
  | "attachment_committed"
  | "ready";

/**
 * Durable, host-resolved evidence for a possibly interrupted arXiv import.
 * Prospective keys and the verified byte identity are recorded before a
 * native commit. Recovery may inspect these identities but never recreates or
 * resumes the mutation.
 */
export interface ArxivImportRecoveryEvidence {
  kind: "arxiv_import";
  stage: ArxivImportRecoveryStage;
  source: ArxivSource;
  libraryId: string;
  inspectionToken: string;
  selection: ImportSelection;
  initialCandidates: ArxivCandidate[];
  expectedPdf: {
    fingerprint: string;
    byteLength: number | null;
    pageCount: number | null;
    stagingId: string | null;
  };
  itemKey: string;
  itemAction: "created" | "reused";
  /** Whether this operation owns staged bytes or only confirmed existing native bytes. */
  pdfAction: "downloaded" | "reused";
  attachmentKey: string;
  operationMarker: string;
  parentProvenance: string;
  attachmentProvenance: string;
  /** Present only after exact native parent/PDF readback was confirmed. */
  result?: EnsureArxivPdfResult & { completion: "ready" };
}

export type NativeOperationEvidence = ArxivImportRecoveryEvidence;

export interface OperationRecord {
  protocolVersion: 1;
  operationId: string;
  /** Digest of canonical request fields other than operationId. */
  requestDigest: string;
  operation: OperationName;
  profileId: string | null;
  mutation: boolean;
  state: OperationState;
  response: ProtocolResponse;
  /** Absent on 0.1.0 records and operations without staged native recovery. */
  nativeEvidence?: NativeOperationEvidence;
}

export interface MutationOperationRecord extends OperationRecord {
  operation: MutationOperationName;
  mutation: true;
  profileId: string;
}
