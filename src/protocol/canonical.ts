import type { ProtocolRequest } from "./types.js";

function canonicalValue(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Canonical JSON cannot encode ${path}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`)).join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Canonical JSON requires a plain object at ${path}`);
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        const entry = record[key];
        if (entry === undefined) {
          throw new TypeError(`Canonical JSON cannot encode undefined at ${path}.${key}`);
        }
        return `${JSON.stringify(key)}:${canonicalValue(entry, `${path}.${key}`)}`;
      });
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Canonical JSON cannot encode ${typeof value} at ${path}`);
}

/** Deterministic JSON for already validated protocol data. */
export function canonicalizeJson(value: unknown): string {
  return canonicalValue(value, "$");
}

/**
 * Returns the immutable request material paired with operationId. The ID itself
 * is excluded; operation, profile, authorization, and payload are all covered.
 */
export function canonicalRequestBytes(request: ProtocolRequest): Uint8Array {
  const { operationId: _operationId, ...immutableRequest } = request;
  return new TextEncoder().encode(canonicalizeJson(immutableRequest));
}
