import type { PayloadDigestPort } from "../../ports/digest.js";
import type {
  ArxivInspectionSnapshot,
  ArxivInspectionTokenPort,
} from "../../ports/arxiv.js";
import { canonicalizeJson } from "../../protocol/canonical.js";

const encoder = new TextEncoder();
const TOKEN_PREFIX = "inspection:";

/** Deterministic optimistic evidence over the complete inspected snapshot. */
export class DigestArxivInspectionTokens implements ArxivInspectionTokenPort {
  readonly #digest: PayloadDigestPort;

  constructor(digest: PayloadDigestPort) {
    this.#digest = digest;
  }

  async issue(snapshot: ArxivInspectionSnapshot): Promise<string> {
    const digest = await this.#digest.digest(encoder.encode(canonicalizeJson(snapshot)));
    if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
      throw new Error("The inspection token digest provider returned invalid SHA-256 evidence");
    }
    return `${TOKEN_PREFIX}${digest}`;
  }

  async matches(token: string, snapshot: ArxivInspectionSnapshot): Promise<boolean> {
    if (!token.startsWith(TOKEN_PREFIX)) return false;
    return token === await this.issue(snapshot);
  }
}
