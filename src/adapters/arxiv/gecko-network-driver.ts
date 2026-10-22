import type {
  ArxivNetworkDriver,
  ArxivNetworkRequest,
  ArxivNetworkResponse,
} from "./http-adapter.js";

interface GeckoReadableStreamReader {
  read(): Promise<{ done: boolean; value?: unknown }>;
  cancel(reason?: unknown): Promise<unknown> | unknown;
  releaseLock?(): void;
}

interface GeckoFetchResponse {
  url: string;
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): GeckoReadableStreamReader } | null;
}

export interface GeckoArxivNetworkEnvironment {
  /** Bound privileged owner-realm fetch, not Zotero.HTTP.download. */
  fetch(
    url: string,
    init: {
      method: "GET";
      headers: Readonly<Record<string, string>>;
      redirect: "manual";
      credentials: "omit";
      signal: AbortSignal;
    },
  ): Promise<GeckoFetchResponse>;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function chunkByteLength(value: unknown): number {
  if (isArrayBuffer(value) || ArrayBuffer.isView(value)) return value.byteLength;
  return NaN;
}

function normalizeChunk(value: unknown): Uint8Array {
  if (isArrayBuffer(value)) return Uint8Array.from(new Uint8Array(value));
  if (!ArrayBuffer.isView(value)) {
    throw new Error("The privileged arXiv fetch returned a non-binary response chunk");
  }
  const view = value as ArrayBufferView;
  return Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

async function cancelReader(reader: GeckoReadableStreamReader, reason: string): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // The response/consumer failure remains authoritative; cancellation is cleanup.
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // The response/consumer failure remains authoritative; release is cleanup.
    }
  }
}

function releaseReader(reader: GeckoReadableStreamReader): void {
  try {
    reader.releaseLock?.();
  } catch {
    // A completed response remains authoritative; release is cleanup.
  }
}

function streamedBody(
  reader: GeckoReadableStreamReader,
  byteLimit: number,
): AsyncIterable<Uint8Array> {
  let claimed = false;
  return {
    [Symbol.asyncIterator]() {
      if (claimed) throw new Error("The privileged arXiv response stream was already consumed");
      claimed = true;
      let finished = false;
      let total = 0;
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          if (finished) return { done: true, value: undefined };
          let result: { done: boolean; value?: unknown };
          try {
            result = await reader.read();
          } catch (error) {
            finished = true;
            await cancelReader(reader, "arXiv response read failed");
            throw error;
          }
          if (result.done) {
            finished = true;
            releaseReader(reader);
            return { done: true, value: undefined };
          }
          const length = chunkByteLength(result.value);
          if (!Number.isSafeInteger(length) || length < 0) {
            finished = true;
            await cancelReader(reader, "invalid arXiv response chunk");
            throw new Error("The privileged arXiv fetch returned a non-binary response chunk");
          }
          total += length;
          if (!Number.isSafeInteger(total) || total > byteLimit) {
            finished = true;
            await cancelReader(reader, "arXiv response byte limit exceeded");
            throw new Error(`The privileged arXiv response exceeded its ${String(byteLimit)} byte limit`);
          }
          try {
            return { done: false, value: normalizeChunk(result.value) };
          } catch (error) {
            finished = true;
            await cancelReader(reader, "invalid arXiv response chunk");
            throw error;
          }
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          if (!finished) {
            finished = true;
            await cancelReader(reader, "arXiv response consumer stopped");
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

/** Privileged Gecko fetch adapted to manual-redirect bounded streaming. */
export class GeckoArxivNetworkDriver implements ArxivNetworkDriver {
  readonly #environment: GeckoArxivNetworkEnvironment;

  constructor(environment: GeckoArxivNetworkEnvironment) {
    if (typeof environment.fetch !== "function") {
      throw new Error("A bound privileged Gecko fetch implementation is required");
    }
    this.#environment = environment;
  }

  async request(request: ArxivNetworkRequest): Promise<ArxivNetworkResponse> {
    const response = await this.#environment.fetch(request.url, {
      method: "GET",
      headers: request.headers,
      redirect: "manual",
      credentials: "omit",
      signal: request.signal,
    });
    if (response.body === null || typeof response.body.getReader !== "function") {
      throw new Error("The privileged arXiv fetch did not expose a streaming response body");
    }
    const reader = response.body.getReader();
    return {
      url: response.url,
      status: response.status,
      headers: { get: (name) => response.headers.get(name) },
      body: streamedBody(reader, request.byteLimit),
    };
  }
}
