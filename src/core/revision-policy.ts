import { CoreOperationError } from "./errors.js";

/**
 * Enforces optimistic concurrency against the adapter's current opaque token.
 * A conflict requires a fresh read and newly authorized operation; it is not a
 * retry instruction for the stale request.
 */
export function assertExpectedRevision(
  expectedRevision: string,
  currentRevision: string,
): void {
  if (expectedRevision === currentRevision) return;
  throw new CoreOperationError(
    "conflict",
    "The target revision changed; re-read the target and renew authorization before updating",
    false,
  );
}
