import type { ProtocolError, ProtocolErrorCode } from "../protocol/types.js";

export class CoreOperationError extends Error {
  readonly code: ProtocolErrorCode;
  readonly retryable: boolean;

  constructor(code: ProtocolErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "CoreOperationError";
    this.code = code;
    this.retryable = retryable;
  }

  toProtocolError(): ProtocolError {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}
