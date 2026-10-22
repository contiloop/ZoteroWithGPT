import type {
  ArticleIdentity,
  ArxivCandidate,
  ArxivSource,
  ArxivUrlReference,
  ImportSelection,
} from "../protocol/types.js";
import type {
  OperationExecutionOutcome,
  OperationIdentity,
} from "./execution.js";

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

export interface VerifiedArxivPdf extends AcquiredArxivPdf {
  fingerprint: string;
  byteLength: number;
  pageCount: number;
}

export interface ArxivPdfAcquisitionPort {
  acquire(source: ArticleIdentity): Promise<VerifiedArxivPdf>;
}

/** Opaque staging identity; concrete paths never cross this boundary. */
export interface StagedArxivPdf {
  stagingId: string;
  source: ArticleIdentity;
  fingerprint: string;
  byteLength: number;
  pageCount: number;
}

export interface ArxivPdfStagingPort {
  stage(pdf: VerifiedArxivPdf): Promise<StagedArxivPdf>;
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
  inspectionToken: string;
  /** Captured before source re-resolution or other awaited ensure work. */
  accessFence: string;
  identity: OperationIdentity;
}

/** Native inspection plus staged, recoverable parent/PDF commit workflow. */
export interface ArxivNativeImportPort {
  captureAccessFence(): string;
  inspect(source: ArxivSource): Promise<ArxivNativeInspection>;
  ensure(input: ArxivNativeImportInput): Promise<OperationExecutionOutcome>;
}
