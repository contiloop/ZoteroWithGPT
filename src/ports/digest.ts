/** Implementations must use a collision-resistant cryptographic digest. */
export interface PayloadDigestPort {
  /** Returns a stable, algorithm-qualified digest such as `sha256:<hex>`. */
  digest(canonicalBytes: Uint8Array): Promise<string>;
}
