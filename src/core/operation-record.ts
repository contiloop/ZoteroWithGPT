import type {
  MutationOperationName,
  OperationName,
  OperationState,
  ProtocolResponse,
} from "../protocol/types.js";

export interface OperationRecord {
  protocolVersion: 1;
  operationId: string;
  /** Digest of canonical request fields other than operationId. */
  requestDigest: string;
  operation: OperationName;
  profileId: string | null;
  mutation: boolean;
  state: OperationState;
  response: ProtocolResponse;
}

export interface MutationOperationRecord extends OperationRecord {
  operation: MutationOperationName;
  mutation: true;
  profileId: string;
}
