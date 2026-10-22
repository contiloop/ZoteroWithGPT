import type {
  ArticleIdentity,
  ArxivCandidate,
  ImportSelection,
} from "../protocol/types.js";
import { CoreOperationError } from "./errors.js";

type SelectionOf<K extends ImportSelection["kind"]> = Extract<ImportSelection, { kind: K }>;

export type ArxivImportDecision =
  | {
      decision: "create";
      reason: string;
      selection: SelectionOf<"create">;
    }
  | {
      decision: "attach";
      reason: string;
      selection: SelectionOf<"attach">;
    }
  | {
      decision: "reuse";
      reason: string;
      selection: SelectionOf<"reuse">;
    }
  | {
      decision: "needs_choice";
      reason: string;
    };

export interface ArxivDecisionEvidence {
  /** When present, verified reuse must match the bytes already acquired for the source. */
  expectedPdfFingerprint?: string;
}

function needsChoice(reason: string): ArxivImportDecision {
  return { decision: "needs_choice", reason };
}

function exactVerifiedAttachment(
  source: ArticleIdentity,
  attachment: ArxivCandidate["attachments"][number],
  evidence: ArxivDecisionEvidence,
): boolean {
  return (
    attachment.identity === "verified" &&
    attachment.version === source.version &&
    typeof attachment.fingerprint === "string" &&
    attachment.fingerprint.length > 0 &&
    (
      evidence.expectedPdfFingerprint === undefined ||
      attachment.fingerprint === evidence.expectedPdfFingerprint
    )
  );
}

/** Computes only an unambiguous default from one complete native candidate snapshot. */
export function decideArxivImport(
  source: ArticleIdentity,
  candidates: readonly ArxivCandidate[],
  evidence: ArxivDecisionEvidence = {},
): ArxivImportDecision {
  if (candidates.length === 0) {
    return {
      decision: "create",
      reason: "No canonical arXiv parent exists in the inspected library snapshot.",
      selection: { kind: "create" },
    };
  }
  if (candidates.length !== 1) {
    return needsChoice("Multiple canonical arXiv parents require an explicit target choice.");
  }
  const candidate = candidates[0] as ArxivCandidate;
  if (candidate.attachments.length === 0) {
    return {
      decision: "attach",
      reason: "The unique canonical parent has no competing PDF attachment.",
      selection: {
        kind: "attach",
        itemKey: candidate.itemKey,
        expectedItemRevision: candidate.itemRevision,
      },
    };
  }
  if (candidate.attachments.length !== 1) {
    return needsChoice("Multiple PDF attachments require an explicit attachment choice.");
  }
  const attachment = candidate.attachments[0] as ArxivCandidate["attachments"][number];
  if (!exactVerifiedAttachment(source, attachment, evidence)) {
    return needsChoice(
      "The existing PDF has conflicting, incomplete, or different-version identity evidence.",
    );
  }
  return {
    decision: "reuse",
    reason: "The unique PDF has verified identity, version, and fingerprint evidence.",
    selection: {
      kind: "reuse",
      itemKey: candidate.itemKey,
      attachmentKey: attachment.attachmentKey,
      expectedFingerprint: attachment.fingerprint as string,
    },
  };
}

function uniqueCandidate(candidates: readonly ArxivCandidate[], itemKey: string): ArxivCandidate {
  const matches = candidates.filter((candidate) => candidate.itemKey === itemKey);
  if (matches.length !== 1) {
    throw new CoreOperationError(
      "ambiguous_target",
      "The selected arXiv parent is absent or ambiguous in the inspected snapshot",
    );
  }
  return matches[0] as ArxivCandidate;
}

/** Validates a later explicit choice against the exact inspected snapshot without mutation. */
export function validateArxivImportSelection(
  source: ArticleIdentity,
  candidates: readonly ArxivCandidate[],
  selection: ImportSelection,
  evidence: ArxivDecisionEvidence = {},
): void {
  if (selection.kind === "create") {
    if (candidates.length !== 0) {
      throw new CoreOperationError(
        "ambiguous_target",
        "A create choice cannot bypass an existing canonical arXiv parent",
      );
    }
    return;
  }
  const candidate = uniqueCandidate(candidates, selection.itemKey);
  if (selection.kind === "attach") {
    if (candidate.itemRevision !== selection.expectedItemRevision) {
      throw new CoreOperationError(
        "conflict",
        "The selected arXiv parent changed after inspection",
      );
    }
    return;
  }

  const attachments = candidate.attachments.filter(
    (attachment) => attachment.attachmentKey === selection.attachmentKey,
  );
  if (attachments.length !== 1) {
    throw new CoreOperationError(
      "ambiguous_target",
      "The selected arXiv PDF is absent or ambiguous in the inspected snapshot",
    );
  }
  const attachment = attachments[0] as ArxivCandidate["attachments"][number];
  if (attachment.fingerprint !== selection.expectedFingerprint) {
    throw new CoreOperationError(
      "stale_attachment",
      "The selected arXiv PDF fingerprint changed after inspection",
    );
  }
  if (!exactVerifiedAttachment(source, attachment, evidence)) {
    throw new CoreOperationError(
      "ambiguous_target",
      "The selected PDF does not have verified exact-version identity evidence",
    );
  }
}
