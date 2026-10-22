import { CoreOperationError } from "../../core/errors.js";
import type { ProtocolErrorCode } from "../../protocol/types.js";

export type ArxivAcquisitionStage = "source" | "download";

/** A definitive pre-native failure. No Zotero mutation can have occurred. */
export class ArxivAcquisitionError extends CoreOperationError {
  readonly stage: ArxivAcquisitionStage;
  readonly nativeMutationPossible = false as const;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    options: {
      stage: ArxivAcquisitionStage;
      retryable?: boolean;
      retryAfterSeconds?: number;
    },
  ) {
    super(code, message, options.retryable ?? false);
    this.name = "ArxivAcquisitionError";
    this.stage = options.stage;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
