import type { ProtocolRequest } from "../protocol/types.js";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Takes a synchronous ownership snapshot before an async digest or adapter can
 * yield. Validated requests contain only structured-cloneable JSON data.
 */
export function snapshotProtocolRequest(request: ProtocolRequest): ProtocolRequest {
  return deepFreeze(structuredClone(request));
}
