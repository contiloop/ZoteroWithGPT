import type {
  ArticleIdentity,
  ArxivCandidate,
  ArxivSource,
  ArxivUrlReference,
  EnsureArxivPdfResult,
  ImportSelection,
  VerificationDetail,
} from "../protocol/types.js";
import type { OperationIdentity } from "./execution.js";

/**
 * The HTTP adapter receives typed arXiv resources, never a caller-controlled
 * download URL. The adapter constructs the official retrieval URL itself.
 */
export type ArxivHttpResource =
  | { kind: "metadata"; reference: ArxivUrlReference }
  | { kind: "pdf"; source: ArticleIdentity };

export interface ArxivHttpResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

export interface ArxivHttpPort {
  retrieve(resource: ArxivHttpResource): Promise<ArxivHttpResponse>;
}

/** Resolves one URL to exactly one canonical metadata entry and version. */
export interface ArxivSourceAcquisitionPort {
  inspect(reference: ArxivUrlReference): Promise<ArxivSource>;
}

export interface AcquiredArxivPdf {
  source: ArticleIdentity;
  contentType: "application/pdf";
  body: Uint8Array;
}

export interface ArxivPdfAcquisitionPort {
  acquire(source: ArticleIdentity): Promise<AcquiredArxivPdf>;
}

/** Opaque staging identity; concrete paths never cross this boundary. */
export interface StagedArxivPdf {
  stagingId: string;
  source: ArticleIdentity;
  fingerprint: string;
  byteLength: number;
}

export interface ArxivPdfStagingPort {
  stage(pdf: AcquiredArxivPdf): Promise<StagedArxivPdf>;
  discard(stagingId: string): Promise<void>;
}

export interface ArxivNativeInspection {
  libraryId: string;
  candidates: ArxivCandidate[];
}

export interface ArxivInspectionSnapshot extends ArxivNativeInspection {
  source: ArxivSource;
}

/** The token binds a complete snapshot; it is optimistic evidence, not authority. */
export interface ArxivInspectionTokenPort {
  issue(snapshot: ArxivInspectionSnapshot): Promise<string>;
  matches(token: string, snapshot: ArxivInspectionSnapshot): Promise<boolean>;
}

export interface ArxivNativeImportInput {
  source: ArxivSource;
  selection: ImportSelection;
  stagedPdf?: StagedArxivPdf;
  identity: OperationIdentity;
}

/** Native-only parent/PDF inspection, commit, and exact storage readback. */
export interface ArxivNativeImportPort {
  inspect(source: ArxivSource): Promise<ArxivNativeInspection>;
  ensure(input: ArxivNativeImportInput): Promise<EnsureArxivPdfResult>;
  confirm(
    result: EnsureArxivPdfResult,
    identity: OperationIdentity,
  ): Promise<VerificationDetail>;
}
