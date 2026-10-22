import type { PayloadDigestPort } from "../ports/digest.js";
import type {
  OperationExecutionOutcome,
  OperationIdentity,
  OperationRecoveryPort,
} from "../ports/execution.js";
import type {
  MutationSerializationPort,
  OperationPersistencePort,
} from "../ports/operation-persistence.js";
import {
  PROTOCOL_VERSION,
  canonicalRequestBytes,
  isEnsureArxivItemOnlyResult,
  isEnsureArxivReadyResult,
  isMutationOperation,
  type OperationState,
  type ProtocolError,
  type ProtocolRequest,
  type ProtocolResponse,
  type VerificationSummary,
} from "../protocol/index.js";
import { assertRequestAuthorizedForProfile } from "./authorization.js";
import { CoreOperationError } from "./errors.js";
import { transitionOperationState } from "./lifecycle.js";
import type { OperationRecord } from "./operation-record.js";
import { snapshotProtocolRequest } from "./request-snapshot.js";

export interface OperationCoordinatorDependencies {
  store: OperationPersistencePort;
  digest: PayloadDigestPort;
  serializer: MutationSerializationPort;
}

export type ExecuteOperation = (
  request: ProtocolRequest,
  identity: OperationIdentity,
) => Promise<OperationExecutionOutcome>;

function uncheckedVerification(): VerificationSummary {
  return { storage: "not_checked", viewer: "not_checked" };
}

function response(
  operationId: string,
  state: OperationState,
  data: object | null,
  error: ProtocolError | null,
  verification: VerificationSummary = uncheckedVerification(),
): ProtocolResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    operationId,
    state,
    data,
    error,
    verification,
  };
}

function coreErrorResponse(
  operationId: string,
  state: Extract<OperationState, "rejected" | "failed" | "indeterminate">,
  error: CoreOperationError,
  verification: VerificationSummary = uncheckedVerification(),
): ProtocolResponse {
  return response(operationId, state, null, error.toProtocolError(), verification);
}

export class OperationCoordinator {
  readonly #store: OperationPersistencePort;
  readonly #digest: PayloadDigestPort;
  readonly #serializer: MutationSerializationPort;
  readonly #submissionTails = new Map<string, Promise<void>>();

  constructor(dependencies: OperationCoordinatorDependencies) {
    this.#store = dependencies.store;
    this.#digest = dependencies.digest;
    this.#serializer = dependencies.serializer;
  }

  async get(operationId: string): Promise<ProtocolResponse | undefined> {
    return (await this.#store.load(operationId))?.response;
  }

  submit(
    request: ProtocolRequest,
    connectedProfileId: string | undefined,
    execute: ExecuteOperation,
  ): Promise<ProtocolResponse> {
    const acceptedRequest = snapshotProtocolRequest(request);
    return this.#runSubmissionExclusive(acceptedRequest.operationId, () =>
      this.#submitAccepted(acceptedRequest, connectedProfileId, execute),
    );
  }

  async #submitAccepted(
    acceptedRequest: ProtocolRequest,
    connectedProfileId: string | undefined,
    execute: ExecuteOperation,
  ): Promise<ProtocolResponse> {
    const requestDigest = await this.#digest.digest(canonicalRequestBytes(acceptedRequest));
    if (requestDigest.trim().length === 0) {
      throw new Error("PayloadDigestPort returned an empty digest");
    }
    const mutation = isMutationOperation(acceptedRequest.operation);
    const initialResponse = response(acceptedRequest.operationId, "queued", null, null);
    const initial: OperationRecord = {
      protocolVersion: PROTOCOL_VERSION,
      operationId: acceptedRequest.operationId,
      requestDigest,
      operation: acceptedRequest.operation,
      profileId: acceptedRequest.profileId ?? null,
      mutation,
      state: "queued",
      response: initialResponse,
    };

    const claim = await this.#store.claim(initial);
    if (claim.kind === "existing") {
      if (claim.record.requestDigest !== requestDigest) {
        return coreErrorResponse(
          acceptedRequest.operationId,
          "rejected",
          new CoreOperationError(
            "duplicate_id_mismatch",
            "The operation ID was already used with different request content",
          ),
        );
      }
      if (claim.record.state === "queued") {
        try {
          assertRequestAuthorizedForProfile(acceptedRequest, connectedProfileId);
        } catch (error) {
          if (!(error instanceof CoreOperationError)) throw error;
          return coreErrorResponse(acceptedRequest.operationId, "rejected", error);
        }
        return (await this.#rejectInterruptedQueued(claim.record, connectedProfileId)).response;
      }
      return claim.record.response;
    }

    const queued = claim.record;
    try {
      assertRequestAuthorizedForProfile(acceptedRequest, connectedProfileId);
    } catch (error) {
      if (!(error instanceof CoreOperationError)) throw error;
      const rejected = coreErrorResponse(acceptedRequest.operationId, "rejected", error);
      return (await this.#move(queued, "rejected", rejected)).response;
    }

    const runningResponse = response(acceptedRequest.operationId, "running", null, null);
    const running = await this.#move(queued, "running", runningResponse);
    const identity: OperationIdentity = {
      operationId: acceptedRequest.operationId,
      requestDigest,
    };

    let outcome: OperationExecutionOutcome;
    try {
      const work = () => execute(acceptedRequest, identity);
      if (mutation) {
        const profileId = acceptedRequest.profileId;
        if (profileId === undefined) {
          throw new CoreOperationError("invalid_request", "Mutation profileId is missing");
        }
        outcome = await this.#serializer.runExclusive(profileId, work);
      } else {
        outcome = await work();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown execution error";
      outcome = mutation
        ? {
            kind: "indeterminate",
            error: {
              code: "unknown_outcome",
              message: `The native mutation outcome is unknown: ${detail}`,
              retryable: false,
            },
            verification: uncheckedVerification(),
          }
        : {
            kind: "failed",
            error: { code: "storage_error", message: detail, retryable: true },
            verification: { storage: "not_applicable", viewer: "not_checked" },
          };
    }

    return (await this.#finish(running, outcome)).response;
  }

  /**
   * Recovers every durable nonterminal record before a transport accepts work.
   * Queued records are known not to have reached native execution and are
   * terminally rejected; running records use marker reconciliation.
   */
  async recoverPending(
    connectedProfileId: string | undefined,
    recovery: OperationRecoveryPort,
  ): Promise<ProtocolResponse[]> {
    const snapshots = await this.#store.listPending();
    const responses: ProtocolResponse[] = [];
    for (const snapshot of snapshots) {
      const recovered = await this.#runSubmissionExclusive(snapshot.operationId, async () => {
        const current = await this.#store.load(snapshot.operationId);
        if (current === undefined) return undefined;
        if (current.state === "queued") {
          return (await this.#rejectInterruptedQueued(current, connectedProfileId)).response;
        }
        if (current.state === "running") {
          return (await this.#reconcileLoadedRunning(current, connectedProfileId, recovery)).response;
        }
        return current.response;
      });
      if (recovered !== undefined) responses.push(recovered);
    }
    return responses;
  }

  /** Reconciles only a crash-left running record and never calls the writer. */
  reconcileRunning(
    operationId: string,
    connectedProfileId: string | undefined,
    recovery: OperationRecoveryPort,
  ): Promise<ProtocolResponse> {
    return this.#runSubmissionExclusive(operationId, async () => {
      const record = await this.#store.load(operationId);
      if (record === undefined) {
        throw new CoreOperationError("not_found", "No durable operation has that ID");
      }
      if (record.state !== "running") return record.response;
      return (await this.#reconcileLoadedRunning(record, connectedProfileId, recovery)).response;
    });
  }

  async #reconcileLoadedRunning(
    record: OperationRecord,
    connectedProfileId: string | undefined,
    recovery: OperationRecoveryPort,
  ): Promise<OperationRecord> {
    this.#assertRecordProfile(record, connectedProfileId);
    if (!record.mutation || record.profileId === null) {
      const outcome = await recovery.reconcile(record);
      return this.#finish(record, outcome);
    }
    const outcome = await this.#serializer.runExclusive(record.profileId, () =>
      recovery.reconcile(record),
    );
    return this.#finish(record, outcome);
  }

  async #rejectInterruptedQueued(
    record: OperationRecord,
    connectedProfileId: string | undefined,
  ): Promise<OperationRecord> {
    this.#assertRecordProfile(record, connectedProfileId);
    const detail = record.mutation
      ? "The queued mutation was interrupted before native execution. It was not written and " +
        "will not be resumed automatically; re-read the target and submit a new operation ID " +
        "with renewed authorization."
      : "The queued operation was interrupted before execution. It was not run and will not " +
        "be resumed automatically; submit a new operation ID.";
    const rejected = coreErrorResponse(
      record.operationId,
      "rejected",
      new CoreOperationError("storage_error", detail, false),
    );
    return this.#move(record, "rejected", rejected);
  }

  #assertRecordProfile(
    record: OperationRecord,
    connectedProfileId: string | undefined,
  ): void {
    if (record.profileId === null) return;
    if (connectedProfileId === undefined) {
      throw new CoreOperationError("not_connected", "No enabled Zotero profile is connected");
    }
    if (connectedProfileId !== record.profileId) {
      throw new CoreOperationError(
        "permission_denied",
        "The operation belongs to a different Zotero profile",
      );
    }
  }

  async #finish(
    running: OperationRecord,
    outcome: OperationExecutionOutcome,
  ): Promise<OperationRecord> {
    if (outcome.kind === "completed") {
      if (
        running.operation === "ensure_arxiv_pdf" &&
        (!isEnsureArxivReadyResult(outcome.data) || outcome.verification.viewer !== "not_checked")
      ) {
        const indeterminate = coreErrorResponse(
          running.operationId,
          "indeterminate",
          new CoreOperationError(
            "unknown_outcome",
            "The arXiv import returned invalid completion or viewer evidence; its native outcome must be reconciled",
          ),
          outcome.verification,
        );
        return this.#move(running, "indeterminate", indeterminate);
      }
      if (running.mutation && outcome.verification.storage !== "confirmed") {
        if (outcome.verification.storage === "failed") {
          const failed = coreErrorResponse(
            running.operationId,
            "failed",
            new CoreOperationError(
              "verification_failed",
              "The native write could not be confirmed by storage readback",
            ),
            outcome.verification,
          );
          return this.#move(running, "failed", failed);
        }
        const indeterminate = coreErrorResponse(
          running.operationId,
          "indeterminate",
          new CoreOperationError(
            "unknown_outcome",
            "The native write has no confirmed storage readback; it must not be retried blindly",
          ),
          outcome.verification,
        );
        return this.#move(running, "indeterminate", indeterminate);
      }
      const succeeded = response(
        running.operationId,
        "succeeded",
        outcome.data,
        null,
        outcome.verification,
      );
      return this.#move(running, "succeeded", succeeded);
    }

    const retainedData =
      outcome.kind === "failed" &&
      "data" in outcome &&
      running.operation === "ensure_arxiv_pdf" &&
      outcome.error.code === "storage_error" &&
      outcome.verification.storage === "confirmed" &&
      outcome.verification.viewer === "not_checked" &&
      isEnsureArxivItemOnlyResult(outcome.data)
        ? outcome.data
        : null;
    const failed = response(
      running.operationId,
      outcome.kind,
      retainedData,
      outcome.error,
      outcome.verification,
    );
    return this.#move(running, outcome.kind, failed);
  }

  async #move(
    current: OperationRecord,
    state: OperationState,
    nextResponse: ProtocolResponse,
  ): Promise<OperationRecord> {
    transitionOperationState(current.state, state);
    const next: OperationRecord = { ...current, state, response: nextResponse };
    return this.#store.transition(current.operationId, current.state, next);
  }

  async #runSubmissionExclusive<T>(operationId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#submissionTails.get(operationId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    this.#submissionTails.set(operationId, current);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.#submissionTails.get(operationId) === current) {
        void current.finally(() => {
          if (this.#submissionTails.get(operationId) === current) {
            this.#submissionTails.delete(operationId);
          }
        });
      }
    }
  }
}
