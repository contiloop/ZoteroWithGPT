import type {
  AcquiredArxivPdf,
  ArxivHttpPort,
  ArxivPdfAcquisitionPort,
} from "../../ports/arxiv.js";
import type { PayloadDigestPort } from "../../ports/digest.js";
import type { ArticleIdentity } from "../../protocol/types.js";
import { ProtocolValidationError } from "../../protocol/validation.js";
import { ArxivAcquisitionError } from "./errors.js";

export interface ArxivPdfReadability {
  /** Positive only after the host PDF parser opened the supplied bytes. */
  pageCount: number;
}

/** Implementations must retain or clone bytes before passing them to a transferable worker API. */
export interface ArxivPdfReadabilityPort {
  inspect(bytes: Uint8Array): Promise<ArxivPdfReadability>;
}

export interface VerifiedArxivPdf extends AcquiredArxivPdf {
  fingerprint: string;
  byteLength: number;
  pageCount: number;
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  const length = Math.min(bytes.byteLength, 1024);
  for (let index = 0; index <= length - 5; index += 1) {
    if (
      bytes[index] === 0x25 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x44 &&
      bytes[index + 3] === 0x46 &&
      bytes[index + 4] === 0x2d
    ) return true;
  }
  return false;
}

export class BoundedArxivPdfAcquisition implements ArxivPdfAcquisitionPort {
  readonly #http: ArxivHttpPort;
  readonly #readability: ArxivPdfReadabilityPort;
  readonly #digest: PayloadDigestPort;

  constructor(
    http: ArxivHttpPort,
    readability: ArxivPdfReadabilityPort,
    digest: PayloadDigestPort,
  ) {
    this.#http = http;
    this.#readability = readability;
    this.#digest = digest;
  }

  async acquire(source: ArticleIdentity): Promise<VerifiedArxivPdf> {
    let response;
    try {
      response = await this.#http.retrieve({ kind: "pdf", source: { ...source } });
    } catch (error) {
      if (error instanceof ArxivAcquisitionError || error instanceof ProtocolValidationError) throw error;
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv PDF request failed before a complete response was available",
        { stage: "download", retryable: true },
      );
    }
    if (response.status !== 200) {
      throw new ArxivAcquisitionError(
        response.status === 404 || response.status === 410 ? "not_found" : "storage_error",
        "The arXiv PDF response was not successful",
        { stage: "download", retryable: response.status >= 500 || response.status === 429 },
      );
    }
    const contentType = response.contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (contentType !== "application/pdf") {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv PDF response did not have the application/pdf media type",
        { stage: "download" },
      );
    }
    if (response.body.byteLength === 0) {
      throw new ArxivAcquisitionError("storage_error", "The arXiv PDF response was empty", {
        stage: "download",
      });
    }
    const retained = Uint8Array.from(response.body);
    if (!hasPdfHeader(retained)) {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv PDF response did not contain a PDF header",
        { stage: "download" },
      );
    }

    let readability: ArxivPdfReadability;
    try {
      readability = await this.#readability.inspect(Uint8Array.from(retained));
    } catch {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The downloaded arXiv PDF could not be opened by the host PDF parser",
        { stage: "download" },
      );
    }
    if (!Number.isSafeInteger(readability.pageCount) || readability.pageCount < 1) {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The host PDF parser did not report a positive page count",
        { stage: "download" },
      );
    }

    let fingerprint: string;
    try {
      fingerprint = await this.#digest.digest(retained);
    } catch {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The downloaded arXiv PDF could not be fingerprinted",
        { stage: "download" },
      );
    }
    if (fingerprint.trim() === "") {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The PDF fingerprint provider returned an empty identity",
        { stage: "download" },
      );
    }
    return {
      source: { ...source },
      contentType: "application/pdf",
      body: retained,
      fingerprint,
      byteLength: retained.byteLength,
      pageCount: readability.pageCount,
    };
  }
}
