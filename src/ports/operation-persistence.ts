import type { OperationRecord } from "../core/operation-record.js";
import type { OperationState } from "../protocol/types.js";

export type OperationClaim =
  | { kind: "created"; record: OperationRecord }
  | { kind: "existing"; record: OperationRecord };

/**
 * Durable operation identity boundary. Implementations must atomically claim an
 * operation ID, use optimistic transitions, and survive ordinary reinstalls.
 */
export interface OperationPersistencePort {
  claim(initial: OperationRecord): Promise<OperationClaim>;
  load(operationId: string): Promise<OperationRecord | undefined>;
  /** Returns durable queued/running records for startup recovery. */
  listPending(): Promise<OperationRecord[]>;
  transition(
    operationId: string,
    expectedState: OperationState,
    next: OperationRecord,
  ): Promise<OperationRecord>;
}

/** Serializes mutation bodies per Zotero profile, including readback. */
export interface MutationSerializationPort {
  runExclusive<T>(profileId: string, work: () => Promise<T>): Promise<T>;
}
