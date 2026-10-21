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

  constructor(dependencies: OperationCoordinatorDependencies) {
    this.#store = dependencies.store;
    this.#digest = dependencies.digest;
    this.#serializer = dependencies.serializer;
  }

  async get(operationId: string): Promise<ProtocolResponse | undefined> {
    return (await this.#store.load(operationId))?.response;
  }

  async submit(
    request: ProtocolRequest,
    connectedProfileId: string | undefined,
    execute: ExecuteOperation,
  ): Promise<ProtocolResponse> {
    const requestDigest = await this.#digest.digest(canonicalRequestBytes(request));
    if (requestDigest.trim().length === 0) {
      throw new Error("PayloadDigestPort returned an empty digest");
    }
    const mutation = isMutationOperation(request.operation);
    const initialResponse = response(request.operationId, "queued", null, null);
    const initial: OperationRecord = {
      protocolVersion: PROTOCOL_VERSION,
      operationId: request.operationId,
      requestDigest,
      operation: request.operation,
      profileId: request.profileId ?? null,
      mutation,
      state: "queued",
      response: initialResponse,
    };

    const claim = await this.#store.claim(initial);
    if (claim.kind === "existing") {
      if (claim.record.requestDigest !== requestDigest) {
        return coreErrorResponse(
          request.operationId,
          "rejected",
          new CoreOperationError(
            "duplicate_id_mismatch",
            "The operation ID was already used with different request content",
          ),
        );
      }
      return claim.record.response;
    }

    let queued = claim.record;
    try {
      assertRequestAuthorizedForProfile(request, connectedProfileId);
    } catch (error) {
      if (!(error instanceof CoreOperationError)) throw error;
      const rejected = coreErrorResponse(request.operationId, "rejected", error);
      return (await this.#move(queued, "rejected", rejected)).response;
    }

    const runningResponse = response(request.operationId, "running", null, null);
    const running = await this.#move(queued, "running", runningResponse);
    const identity: OperationIdentity = { operationId: request.operationId, requestDigest };

    let outcome: OperationExecutionOutcome;
    try {
      const work = () => execute(request, identity);
      if (mutation) {
        const profileId = request.profileId;
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

  /** Reconciles only a crash-left running record and never calls the writer. */
  async reconcileRunning(
    operationId: string,
    connectedProfileId: string | undefined,
    recovery: OperationRecoveryPort,
  ): Promise<ProtocolResponse> {
    const record = await this.#store.load(operationId);
    if (record === undefined) {
      throw new CoreOperationError("not_found", "No durable operation has that ID");
    }
    if (record.state !== "running") return record.response;
    if (!record.mutation || record.profileId === null) {
      const outcome = await recovery.reconcile(record);
      return (await this.#finish(record, outcome)).response;
    }
    if (connectedProfileId === undefined) {
      throw new CoreOperationError("not_connected", "No enabled Zotero profile is connected");
    }
    if (connectedProfileId !== record.profileId) {
      throw new CoreOperationError(
        "permission_denied",
        "The operation belongs to a different Zotero profile",
      );
    }
    const outcome = await this.#serializer.runExclusive(record.profileId, () =>
      recovery.reconcile(record),
    );
    return (await this.#finish(record, outcome)).response;
  }

  async #finish(
    running: OperationRecord,
    outcome: OperationExecutionOutcome,
  ): Promise<OperationRecord> {
    if (outcome.kind === "completed") {
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

    const failed = response(
      running.operationId,
      outcome.kind,
      null,
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
}
