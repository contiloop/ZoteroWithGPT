import type {
  ArxivRemoteResourceKind,
  ArxivRequestAdmissionLease,
  ArxivRequestAdmissionPort,
  ArxivRequestAdmissionRequest,
} from "../../ports/arxiv.js";
import { ArxivAcquisitionError, type ArxivAcquisitionStage } from "./errors.js";

export const ARXIV_METADATA_MINIMUM_INTERVAL_MS = 3_000;

type TimerHandle = unknown;

export interface PoliteArxivRequestAdmissionOptions {
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

interface WaitingRequest {
  kind: ArxivRemoteResourceKind;
  signal: AbortSignal;
  resolve(lease: ArxivRequestAdmissionLease): void;
  reject(error: ArxivAcquisitionError): void;
  onAbort(): void;
  deadlineTimer: TimerHandle;
  settled: boolean;
}

function stageFor(kind: ArxivRemoteResourceKind): ArxivAcquisitionStage {
  return kind === "metadata" ? "source" : "download";
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("maximumWaitMs must be a positive safe integer");
  }
  return value;
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value)) throw new Error("The arXiv admission clock returned an invalid time");
  return value;
}

/**
 * One host-module lane for all arXiv traffic. Metadata request starts are at
 * least three seconds apart, and any server cooldown applies to both routes.
 */
export class PoliteArxivRequestAdmission implements ArxivRequestAdmissionPort {
  readonly #now: () => number;
  readonly #setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  readonly #clearTimer: (handle: TimerHandle) => void;
  readonly #waiting: WaitingRequest[] = [];
  #active = false;
  #nextMetadataStartAt = Number.NEGATIVE_INFINITY;
  #cooldownUntil = Number.NEGATIVE_INFINITY;
  #pacingTimer: TimerHandle | undefined;

  constructor(options: PoliteArxivRequestAdmissionOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? (handle => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  }

  acquire(request: ArxivRequestAdmissionRequest): Promise<ArxivRequestAdmissionLease> {
    const maximumWaitMs = positiveLimit(request.maximumWaitMs);
    if (request.signal.aborted) {
      return Promise.reject(this.#cancelled(request.kind));
    }
    return new Promise((resolve, reject) => {
      const entry = {} as WaitingRequest;
      entry.kind = request.kind;
      entry.signal = request.signal;
      entry.resolve = resolve;
      entry.reject = reject;
      entry.settled = false;
      entry.onAbort = () => {
        this.#reject(entry, this.#cancelled(entry.kind));
      };
      entry.deadlineTimer = this.#setTimer(() => {
        this.#reject(entry, new ArxivAcquisitionError(
          "storage_error",
          `The arXiv request could not be admitted within ${String(maximumWaitMs)} ms`,
          { stage: stageFor(entry.kind), retryable: true },
        ));
      }, maximumWaitMs);
      request.signal.addEventListener("abort", entry.onAbort, { once: true });
      this.#waiting.push(entry);
      this.#pump();
    });
  }

  #cancelled(kind: ArxivRemoteResourceKind): ArxivAcquisitionError {
    return new ArxivAcquisitionError("storage_error", "The arXiv request was cancelled", {
      stage: stageFor(kind),
    });
  }

  #cleanup(entry: WaitingRequest): void {
    this.#clearTimer(entry.deadlineTimer);
    entry.signal.removeEventListener("abort", entry.onAbort);
  }

  #reject(entry: WaitingRequest, error: ArxivAcquisitionError): void {
    if (entry.settled) return;
    entry.settled = true;
    const index = this.#waiting.indexOf(entry);
    if (index >= 0) this.#waiting.splice(index, 1);
    this.#cleanup(entry);
    entry.reject(error);
    this.#pump();
  }

  #clearPacingTimer(): void {
    if (this.#pacingTimer === undefined) return;
    this.#clearTimer(this.#pacingTimer);
    this.#pacingTimer = undefined;
  }

  #pump(): void {
    this.#clearPacingTimer();
    if (this.#active) return;
    const entry = this.#waiting[0];
    if (entry === undefined) return;
    if (entry.signal.aborted) {
      this.#reject(entry, this.#cancelled(entry.kind));
      return;
    }
    const now = safeNow(this.#now);
    if (this.#cooldownUntil > now) {
      const seconds = Math.max(1, Math.ceil((this.#cooldownUntil - now) / 1_000));
      this.#reject(entry, new ArxivAcquisitionError(
        "storage_error",
        `The arXiv service cooldown remains active for ${String(seconds)} seconds`,
        { stage: stageFor(entry.kind), retryable: true, retryAfterSeconds: seconds },
      ));
      return;
    }
    if (entry.kind === "metadata" && this.#nextMetadataStartAt > now) {
      this.#pacingTimer = this.#setTimer(
        () => {
          this.#pacingTimer = undefined;
          this.#pump();
        },
        Math.max(0, this.#nextMetadataStartAt - now),
      );
      return;
    }

    this.#waiting.shift();
    entry.settled = true;
    this.#cleanup(entry);
    this.#active = true;
    if (entry.kind === "metadata") {
      this.#nextMetadataStartAt = now + ARXIV_METADATA_MINIMUM_INTERVAL_MS;
    }
    let released = false;
    entry.resolve({
      defer: retryAfterSeconds => {
        if (released || !Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 0) return;
        const requested = safeNow(this.#now) + retryAfterSeconds * 1_000;
        this.#cooldownUntil = Math.max(
          this.#cooldownUntil,
          Math.min(Number.MAX_SAFE_INTEGER, requested),
        );
      },
      release: () => {
        if (released) return;
        released = true;
        this.#active = false;
        this.#pump();
      },
    });
  }
}
