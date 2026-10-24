export const MAX_WAIT_TIMEOUT_MS = 119_000;

/** Stable error contract exposed by a bridge adapter to the application core. */
export class BridgeAdapterError extends Error {
  constructor(code, message, publication = "unknown", options = undefined) {
    super(message, options);
    this.name = "BridgeAdapterError";
    this.code = code;
    this.publication = publication;
  }
}
