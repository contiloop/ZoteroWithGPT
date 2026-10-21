import type { PayloadDigestPort } from "../../ports/digest.js";

export interface WebCryptoLike {
  subtle: {
    digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
  };
}

export class WebCryptoPayloadDigest implements PayloadDigestPort {
  readonly #crypto: WebCryptoLike;

  constructor(crypto: WebCryptoLike) {
    this.#crypto = crypto;
  }

  async digest(bytes: Uint8Array): Promise<string> {
    const source = Uint8Array.from(bytes);
    const buffer = await this.#crypto.subtle.digest("SHA-256", source);
    const hex = [...new Uint8Array(buffer)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `sha256:${hex}`;
  }
}
