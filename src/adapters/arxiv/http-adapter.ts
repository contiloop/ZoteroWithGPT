import type {
  ArxivHttpPort,
  ArxivHttpResource,
  ArxivHttpResponse,
} from "../../ports/arxiv.js";
import { isValidArxivId } from "../../protocol/validation.js";
import { ProtocolValidationError } from "../../protocol/validation.js";
import { ArxivAcquisitionError, type ArxivAcquisitionStage } from "./errors.js";

export const MAX_ARXIV_METADATA_BYTES = 2 * 1024 * 1024;
export const MAX_ARXIV_PDF_BYTES = 64 * 1024 * 1024;
export const ARXIV_ATTEMPT_TIMEOUT_MS = 60_000;
export const MAX_ARXIV_REDIRECTS = 3;

export interface ArxivNetworkHeaders {
  get(name: string): string | null;
}

export interface ArxivNetworkResponse {
  /** The URL that produced this response. Drivers must not hide redirects. */
  url: string;
  status: number;
  headers: ArxivNetworkHeaders;
  /** Streaming only: a driver must never allocate the complete response before returning. */
  body: AsyncIterable<Uint8Array>;
}

export interface ArxivNetworkRequest {
  method: "GET";
  url: string;
  headers: Readonly<Record<string, string>>;
  redirect: "manual";
  /** Drivers must enforce this ceiling while receiving, before allocating response chunks. */
  byteLimit: number;
  signal: AbortSignal;
}

/** Host-specific HTTP facilities adapt to this manual-redirect streaming shape. */
export interface ArxivNetworkDriver {
  request(request: ArxivNetworkRequest): Promise<ArxivNetworkResponse>;
}

export interface ArxivRetrieveOptions {
  signal?: AbortSignal;
}

export interface BoundedArxivHttpOptions {
  metadataByteLimit?: number;
  pdfByteLimit?: number;
  attemptTimeoutMs?: number;
  maxRedirects?: number;
  now?: () => number;
  createAbortController?: () => AbortController;
}

interface AttemptRedirect {
  kind: "redirect";
  location: string;
}

interface AttemptResponse {
  kind: "response";
  response: ArxivHttpResponse;
}

type AttemptResult = AttemptRedirect | AttemptResponse;

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function redirectLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("maxRedirects must be a nonnegative safe integer");
  }
  return value;
}

function stageFor(resource: ArxivHttpResource): ArxivAcquisitionStage {
  return resource.kind === "metadata" ? "source" : "download";
}

function validateVersion(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new ProtocolValidationError(
      "invalid_request",
      "The arXiv version must be a positive safe integer",
    );
  }
}

function validateResource(resource: ArxivHttpResource): void {
  const identity = resource.kind === "metadata" ? resource.reference : resource.source;
  if (!isValidArxivId(identity.arxivId)) {
    throw new ProtocolValidationError(
      "invalid_request",
      "The arXiv resource must contain a canonical identifier",
    );
  }
  validateVersion(identity.version);
}

function identityReference(resource: ArxivHttpResource): string {
  const identity = resource.kind === "metadata" ? resource.reference : resource.source;
  return `${identity.arxivId}${identity.version === undefined ? "" : `v${String(identity.version)}`}`;
}

function initialUrl(resource: ArxivHttpResource): string {
  const reference = identityReference(resource);
  if (resource.kind === "metadata") {
    return `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(reference)}&max_results=1`;
  }
  return `https://arxiv.org/pdf/${reference}`;
}

function parseAllowedUrl(value: string, stage: ArxivAcquisitionStage): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ArxivAcquisitionError("storage_error", "The arXiv response used a malformed URL", {
      stage,
    });
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "arxiv.org" && url.hostname !== "export.arxiv.org") ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new ArxivAcquisitionError(
      "storage_error",
      "The arXiv response attempted to leave the allowed HTTPS origins",
      { stage },
    );
  }
  return url;
}

function assertResourceUrl(value: string, resource: ArxivHttpResource): URL {
  const stage = stageFor(resource);
  const url = parseAllowedUrl(value, stage);
  const reference = identityReference(resource);
  if (resource.kind === "metadata") {
    const entries = [...url.searchParams.entries()];
    if (
      url.pathname !== "/api/query" ||
      entries.length !== 2 ||
      url.searchParams.get("id_list") !== reference ||
      url.searchParams.get("max_results") !== "1"
    ) {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv metadata response left the fixed query endpoint",
        { stage },
      );
    }
    return url;
  }

  if (
    url.search !== "" ||
    (url.pathname !== `/pdf/${reference}` && url.pathname !== `/pdf/${reference}.pdf`)
  ) {
    throw new ArxivAcquisitionError(
      "storage_error",
      "The arXiv PDF response left the expected article route",
      { stage },
    );
  }
  return url;
}

function mediaType(headers: ArxivNetworkHeaders): string {
  return (headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function contentLength(headers: ArxivNetworkHeaders, stage: ArxivAcquisitionStage): number | undefined {
  const raw = headers.get("content-length");
  if (raw === null) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw.trim())) {
    throw new ArxivAcquisitionError(
      "storage_error",
      "The arXiv response supplied an invalid Content-Length",
      { stage },
    );
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value)) {
    throw new ArxivAcquisitionError("too_large", "The arXiv response length is unsafe", {
      stage,
    });
  }
  return value;
}

function requireStreamingBody(
  body: unknown,
  stage: ArxivAcquisitionStage,
): AsyncIterable<Uint8Array> {
  if (
    body instanceof Uint8Array ||
    body === null ||
    typeof body !== "object" ||
    typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function"
  ) {
    throw new ArxivAcquisitionError(
      "storage_error",
      "The arXiv network driver must return a streamed binary response body",
      { stage },
    );
  }
  return body as AsyncIterable<Uint8Array>;
}

function closeStreamingBody(body: AsyncIterable<Uint8Array>): void {
  try {
    const iterator = body[Symbol.asyncIterator]();
    if (typeof iterator.return === "function") {
      void Promise.resolve(iterator.return()).catch(() => undefined);
    }
  } catch {
    // The response error remains authoritative; cleanup is best effort.
  }
}

async function readBoundedBody(
  response: ArxivNetworkResponse,
  limit: number,
  stage: ArxivAcquisitionStage,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const body = requireStreamingBody(response.body, stage);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const append = (chunk: Uint8Array): void => {
    if (!(chunk instanceof Uint8Array)) {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv network driver returned a non-binary body chunk",
        { stage },
      );
    }
    total += chunk.byteLength;
    if (!Number.isSafeInteger(total) || total > limit) {
      throw new ArxivAcquisitionError(
        "too_large",
        `The arXiv response exceeds the ${String(limit)} byte limit`,
        { stage },
      );
    }
    if (chunk.byteLength > 0) chunks.push(Uint8Array.from(chunk));
  };

  let iterator: AsyncIterator<Uint8Array> | undefined;
  let streamFinished = false;
  let declared: number | undefined;
  try {
    declared = contentLength(response.headers, stage);
    if (declared !== undefined && declared > limit) {
      throw new ArxivAcquisitionError(
        "too_large",
        `The arXiv response exceeds the ${String(limit)} byte limit`,
        { stage },
      );
    }
    iterator = body[Symbol.asyncIterator]();
    if (typeof iterator.next !== "function") {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv network driver returned an invalid response stream",
        { stage },
      );
    }
    while (true) {
      if (signal.aborted) throw new Error("response stream interrupted");
      let onAbort: (() => void) | undefined;
      const interrupted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error("response stream interrupted"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      let result: IteratorResult<Uint8Array>;
      try {
        result = await Promise.race([iterator.next(), interrupted]);
      } finally {
        if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
      }
      if (result.done === true) {
        streamFinished = true;
        break;
      }
      append(result.value);
    }
  } finally {
    if (!streamFinished && iterator !== undefined && typeof iterator.return === "function") {
      try {
        await iterator.return();
      } catch {
        // The acquisition error remains authoritative; cleanup is best effort.
      }
    } else if (!streamFinished && iterator === undefined) {
      closeStreamingBody(body);
    }
  }

  if (declared !== undefined && declared !== total) {
    throw new ArxivAcquisitionError(
      "storage_error",
      "The arXiv response was truncated or did not match Content-Length",
      { stage, retryable: true },
    );
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function retryAfterSeconds(
  headers: ArxivNetworkHeaders,
  now: () => number,
): number | undefined {
  const raw = headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  if (/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    const seconds = Number(raw);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - now()) / 1000));
}

function statusFailure(
  status: number,
  headers: ArxivNetworkHeaders,
  stage: ArxivAcquisitionStage,
  now: () => number,
): never {
  if (status === 404 || status === 410) {
    throw new ArxivAcquisitionError("not_found", "The requested arXiv resource was not found", {
      stage,
    });
  }
  if (status === 429 || status === 503) {
    const delay = retryAfterSeconds(headers, now);
    throw new ArxivAcquisitionError(
      "storage_error",
      status === 429
        ? "The arXiv service rate-limited the request"
        : "The arXiv service is temporarily unavailable",
      {
        stage,
        retryable: true,
        ...(delay === undefined ? {} : { retryAfterSeconds: delay }),
      },
    );
  }
  throw new ArxivAcquisitionError(
    "storage_error",
    `The arXiv service returned HTTP ${String(status)}`,
    { stage, retryable: status >= 500 },
  );
}

export class BoundedArxivHttpAdapter implements ArxivHttpPort {
  readonly #driver: ArxivNetworkDriver;
  readonly #metadataByteLimit: number;
  readonly #pdfByteLimit: number;
  readonly #attemptTimeoutMs: number;
  readonly #maxRedirects: number;
  readonly #now: () => number;
  readonly #createAbortController: () => AbortController;

  constructor(driver: ArxivNetworkDriver, options: BoundedArxivHttpOptions = {}) {
    this.#driver = driver;
    this.#metadataByteLimit = positiveLimit(
      options.metadataByteLimit ?? MAX_ARXIV_METADATA_BYTES,
      "metadataByteLimit",
    );
    this.#pdfByteLimit = positiveLimit(options.pdfByteLimit ?? MAX_ARXIV_PDF_BYTES, "pdfByteLimit");
    this.#attemptTimeoutMs = positiveLimit(
      options.attemptTimeoutMs ?? ARXIV_ATTEMPT_TIMEOUT_MS,
      "attemptTimeoutMs",
    );
    this.#maxRedirects = redirectLimit(options.maxRedirects ?? MAX_ARXIV_REDIRECTS);
    this.#now = options.now ?? Date.now;
    this.#createAbortController = options.createAbortController ?? (() => new AbortController());
  }

  async retrieve(
    resource: ArxivHttpResource,
    options: ArxivRetrieveOptions = {},
  ): Promise<ArxivHttpResponse> {
    validateResource(resource);
    let url = initialUrl(resource);
    let redirects = 0;
    while (true) {
      assertResourceUrl(url, resource);
      const result = await this.#attempt(url, resource, options.signal);
      if (result.kind === "response") return result.response;
      if (redirects >= this.#maxRedirects) {
        throw new ArxivAcquisitionError(
          "storage_error",
          `The arXiv response exceeded the redirect limit of ${String(this.#maxRedirects)}`,
          { stage: stageFor(resource) },
        );
      }
      let redirected: string;
      try {
        redirected = new URL(result.location, url).href;
      } catch {
        throw new ArxivAcquisitionError(
          "storage_error",
          "The arXiv response supplied a malformed redirect location",
          { stage: stageFor(resource) },
        );
      }
      assertResourceUrl(redirected, resource);
      redirects += 1;
      url = redirected;
    }
  }

  async #attempt(
    url: string,
    resource: ArxivHttpResource,
    callerSignal: AbortSignal | undefined,
  ): Promise<AttemptResult> {
    const stage = stageFor(resource);
    const limit = resource.kind === "metadata" ? this.#metadataByteLimit : this.#pdfByteLimit;
    if (callerSignal?.aborted === true) {
      throw new ArxivAcquisitionError("storage_error", "The arXiv request was cancelled", {
        stage,
      });
    }
    const controller = this.#createAbortController();
    let timedOut = false;
    let callerCancelled = false;
    let rejectInterruption: ((reason: Error) => void) | undefined;
    const interruption = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject;
    });
    const onCallerAbort = (): void => {
      callerCancelled = true;
      controller.abort();
      rejectInterruption?.(new Error("caller cancellation"));
    };
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectInterruption?.(new Error("attempt deadline"));
    }, this.#attemptTimeoutMs);

    const work = this.#driver.request({
      method: "GET",
      url,
      headers: Object.freeze({
        Accept: resource.kind === "metadata" ? "application/atom+xml, application/xml" : "application/pdf",
      }),
      redirect: "manual",
      byteLimit: limit,
      signal: controller.signal,
    }).then(async (response): Promise<AttemptResult> => {
      const responseBody = requireStreamingBody(response.body, stage);
      let finalUrl: URL;
      try {
        finalUrl = assertResourceUrl(response.url, resource);
      } catch (error) {
        closeStreamingBody(responseBody);
        if (error instanceof ArxivAcquisitionError) {
          throw new ArxivAcquisitionError(
            error.code,
            "The arXiv network driver returned an unsafe final response URL",
            { stage, retryable: error.retryable },
          );
        }
        throw error;
      }
      if (finalUrl.href !== new URL(url).href) {
        closeStreamingBody(responseBody);
        throw new ArxivAcquisitionError(
          "storage_error",
          "The arXiv network driver hid a redirect in the final response URL",
          { stage },
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (location === null || location.trim() === "") {
          closeStreamingBody(responseBody);
          throw new ArxivAcquisitionError(
            "storage_error",
            "The arXiv redirect did not include a Location header",
            { stage },
          );
        }
        closeStreamingBody(responseBody);
        return { kind: "redirect", location };
      }
      if (response.status !== 200) {
        closeStreamingBody(responseBody);
        statusFailure(response.status, response.headers, stage, this.#now);
      }
      const body = await readBoundedBody(response, limit, stage, controller.signal);
      return {
        kind: "response",
        response: { status: response.status, contentType: mediaType(response.headers), body },
      };
    });

    try {
      return await Promise.race([work, interruption]);
    } catch (error) {
      if (timedOut) {
        throw new ArxivAcquisitionError(
          "storage_error",
          `The arXiv network attempt exceeded its ${String(this.#attemptTimeoutMs)} ms deadline`,
          { stage, retryable: true },
        );
      }
      if (callerCancelled) {
        throw new ArxivAcquisitionError("storage_error", "The arXiv request was cancelled", {
          stage,
        });
      }
      if (error instanceof ArxivAcquisitionError || error instanceof ProtocolValidationError) {
        throw error;
      }
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv network attempt failed before a complete response was received",
        { stage, retryable: true },
      );
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      controller.abort();
    }
  }
}
