import type { OperationState } from "../protocol/types.js";

const transitions: Readonly<Record<OperationState, readonly OperationState[]>> = {
  queued: ["running", "rejected"],
  running: ["succeeded", "rejected", "failed", "indeterminate"],
  succeeded: [],
  rejected: [],
  failed: [],
  indeterminate: [],
};

export const TERMINAL_OPERATION_STATES = [
  "succeeded",
  "rejected",
  "failed",
  "indeterminate",
] as const;

export function transitionOperationState(
  current: OperationState,
  next: OperationState,
): OperationState {
  if (!transitions[current].includes(next)) {
    throw new Error(`Invalid operation state transition: ${current} -> ${next}`);
  }
  return next;
}
