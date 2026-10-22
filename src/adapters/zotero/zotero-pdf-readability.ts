import type {
  ArxivPdfReadability,
  ArxivPdfReadabilityPort,
} from "../arxiv/pdf-acquisition.js";

interface PdfWorkerResult {
  totalPages?: unknown;
}

export interface ZoteroPdfWorkerLike {
  _enqueue<T>(work: () => Promise<T>, priority?: boolean): Promise<T>;
  _query<T>(
    action: string,
    data: { buf: ArrayBuffer; maxPages: number; password: null },
    transfer: ArrayBuffer[],
  ): Promise<T>;
}

export interface ZoteroPdfReadabilityEnvironment {
  worker: ZoteroPdfWorkerLike;
  /** Structured-clones the argument into the PDF worker's privileged owner realm. */
  cloneIntoOwner<T>(value: T): T;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/** Opens retained downloaded bytes through Zotero's genuine PDF worker. */
export class ZoteroPdfReadability implements ArxivPdfReadabilityPort {
  readonly #environment: ZoteroPdfReadabilityEnvironment;

  constructor(environment: ZoteroPdfReadabilityEnvironment) {
    if (
      typeof environment.worker?._enqueue !== "function" ||
      typeof environment.worker?._query !== "function" ||
      typeof environment.cloneIntoOwner !== "function"
    ) {
      throw new Error("Zotero PDF worker owner-realm APIs are unavailable");
    }
    this.#environment = environment;
  }

  async inspect(bytes: Uint8Array): Promise<ArxivPdfReadability> {
    const retained = Uint8Array.from(bytes).buffer;
    const data = this.#environment.cloneIntoOwner({
      buf: retained,
      maxPages: 1,
      password: null,
    });
    if (
      data === null ||
      typeof data !== "object" ||
      !isArrayBuffer(data.buf) ||
      data.buf.byteLength !== bytes.byteLength
    ) {
      throw new Error("The Zotero PDF worker owner realm could not clone the downloaded bytes");
    }
    const result = await this.#environment.worker._enqueue(() =>
      this.#environment.worker._query<PdfWorkerResult>(
        "pdf.getFulltext",
        data,
        [data.buf],
      ),
    true);
    if (!Number.isSafeInteger(result.totalPages) || (result.totalPages as number) < 1) {
      throw new Error("The Zotero PDF worker did not report a positive total page count");
    }
    return { pageCount: result.totalPages as number };
  }
}
