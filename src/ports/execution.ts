import type { OperationRecord } from "../core/operation-record.js";
import type {
  EnsureArxivPdfResult,
  ProtocolError,
  ProtocolRequest,
  VerificationSummary,
} from "../protocol/types.js";

export interface OperationIdentity {
  operationId: string;
  requestDigest: string;
}

export type OperationExecutionOutcome<D extends object = object> =
  | {
      kind: "completed";
      data: D;
      verification: VerificationSummary;
    }
  | {
      kind: "rejected" | "indeterminate";
      error: ProtocolError;
      verification: VerificationSummary;
      data?: never;
    }
  | {
      kind: "failed";
      error: ProtocolError;
      verification: VerificationSummary;
      data?: never;
    }
  | {
      /**
       * The only retained failure shape: a confirmed native parent remains
       * after ensure_arxiv_pdf could not establish a usable PDF attachment.
       */
      kind: "failed";
      data: EnsureArxivPdfResult & { completion: "item_only" };
      error: ProtocolError;
      verification: VerificationSummary;
    };

export interface OperationExecutorPort {
  execute(
    request: ProtocolRequest,
    identity: OperationIdentity,
  ): Promise<OperationExecutionOutcome>;
}

/**
 * Reconciles a durable `running` record after a crash. It must inspect native
 * state using the historical identity and must never invoke a create again.
 */
export interface OperationRecoveryPort {
  reconcile(record: OperationRecord): Promise<OperationExecutionOutcome>;
}
