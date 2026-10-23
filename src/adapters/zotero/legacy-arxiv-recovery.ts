import type { ArxivImportRecoveryEvidence, OperationRecord } from "../../core/operation-record.js";
import type { ArxivNativeInspection } from "../../ports/arxiv.js";
import type { OperationExecutionOutcome, OperationRecoveryPort } from "../../ports/execution.js";
import type { OperationPersistencePort } from "../../ports/operation-persistence.js";
import type { ArxivCandidate, ArxivSource, EnsureArxivPdfResult } from "../../protocol/types.js";
import type { NativeArxivAttachmentRecord, NativeArxivParentRecord, ZoteroNativeApi } from "./native-api.js";
import { arxivAttachmentProvenance, arxivParentProvenance, operationIdentityMarker } from "./record-utils.js";
const unchecked = { storage: "not_checked", viewer: "not_checked" } as const;
const confirmed = { storage: "confirmed", viewer: "not_checked" } as const;
function identity(source: ArxivSource): { arxivId: string; version: number } {
  return { arxivId: source.arxivId, version: source.version };
}

function unknown(message: string): OperationExecutionOutcome {
  return {
    kind: "indeterminate",
    error: { code: "unknown_outcome", message, retryable: false },
    verification: unchecked,
  };
}

function ready(
  evidence: ArxivImportRecoveryEvidence,
  attachment: NativeArxivAttachmentRecord,
): EnsureArxivPdfResult & { completion: "ready" } {
  return {
    source: identity(evidence.source),
    libraryId: evidence.libraryId,
    completion: "ready",
    itemKey: evidence.itemKey,
    itemAction: evidence.itemAction,
    attachmentKey: attachment.attachmentKey,
    attachmentFingerprint: attachment.fingerprint as string,
    pdfAction: evidence.pdfAction,
    deepLink: attachment.deepLink,
  };
}

function itemOnly(
  evidence: ArxivImportRecoveryEvidence,
  parent: NativeArxivParentRecord,
  message: string,
): OperationExecutionOutcome {
  return {
    kind: "failed",
    data: {
      source: identity(evidence.source),
      libraryId: evidence.libraryId,
      completion: "item_only",
      itemKey: evidence.itemKey,
      itemAction: evidence.itemAction,
      attachmentKey: null,
      attachmentFingerprint: null,
      pdfAction: "none",
      deepLink: parent.deepLink,
    },
    error: { code: "storage_error", message, retryable: false },
    verification: confirmed,
  };
}

function sameCandidateSnapshot(
  left: readonly ArxivCandidate[],
  right: readonly ArxivCandidate[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedAttachmentIsReady(
  evidence: ArxivImportRecoveryEvidence,
  attachment: NativeArxivAttachmentRecord,
): boolean {
  const readableBytesMatch =
    attachment.itemKey === evidence.itemKey &&
    attachment.fingerprint === evidence.expectedPdf.fingerprint &&
    attachment.readable &&
    attachment.pageCount !== null &&
    attachment.pageCount > 0 &&
    (evidence.expectedPdf.pageCount === null ||
      attachment.pageCount === evidence.expectedPdf.pageCount);
  if (!readableBytesMatch) return false;
  if (evidence.pdfAction === "downloaded" || evidence.selection.kind === "reuse") {
    return attachment.version === evidence.source.version && attachment.identity === "verified";
  }
  return (
    evidence.selection.kind === "attach" &&
    attachment.canonicalSourceEvidence &&
    (attachment.version === null || attachment.version === evidence.source.version)
  );
}

function ownedAttachmentIdentityMatches(
  evidence: ArxivImportRecoveryEvidence,
  attachment: NativeArxivAttachmentRecord,
): boolean {
  return (
    attachment.itemKey === evidence.itemKey &&
    attachment.version === evidence.source.version &&
    attachment.canonicalSourceEvidence &&
    attachment.operationMarkers.length === 1 &&
    attachment.operationMarkers[0] === evidence.operationMarker &&
    attachment.provenanceMarkers.length === 1 &&
    attachment.provenanceMarkers[0] === evidence.attachmentProvenance
  );
}

/** Reconcile pre-cut import journals without restarting acquisition or native creation. */
export class LegacyArxivRecovery implements OperationRecoveryPort {
  constructor(
    private readonly native: Pick<ZoteroNativeApi,
      "inspectArxiv" | "findArxivByOperationMarker" | "getArxivParent" | "getArxivAttachment">,
    private readonly operations: Pick<OperationPersistencePort, "checkpointNativeEvidence">,
  ) {}
  async reconcile(record: OperationRecord): Promise<OperationExecutionOutcome> {
    if (record.operation !== "ensure_arxiv_pdf" || record.nativeEvidence === undefined) {
      return unknown(
        "The interrupted arXiv import has no durable native stage evidence and must not be retried",
      );
    }
    const evidence = record.nativeEvidence;
    const expectedOperationMarker = operationIdentityMarker({
      operationId: record.operationId,
      requestDigest: record.requestDigest,
    });
    const selectionMatches =
      (evidence.selection.kind === "create" &&
        evidence.itemAction === "created" &&
        evidence.pdfAction === "downloaded") ||
      (evidence.selection.kind === "attach" &&
        evidence.itemAction === "reused" &&
        evidence.selection.itemKey === evidence.itemKey) ||
      (evidence.selection.kind === "reuse" &&
        evidence.itemAction === "reused" &&
        evidence.pdfAction === "reused" &&
        evidence.selection.itemKey === evidence.itemKey &&
        evidence.selection.attachmentKey === evidence.attachmentKey &&
        evidence.selection.expectedFingerprint === evidence.expectedPdf.fingerprint);
    if (
      evidence.operationMarker !== expectedOperationMarker ||
      evidence.parentProvenance !== arxivParentProvenance(evidence.source) ||
      evidence.attachmentProvenance !== arxivAttachmentProvenance(
        evidence.source,
        evidence.expectedPdf.fingerprint,
      ) ||
      !selectionMatches
    ) {
      return unknown("The durable arXiv stage identity is inconsistent and cannot be reconciled");
    }
    if (evidence.stage === "ready" && evidence.result !== undefined) {
      return { kind: "completed", data: evidence.result, verification: confirmed };
    }
    return this.#reconcileEvidence(evidence, record.operationId);
  }

  async #checkpoint(
    operationId: string,
    evidence: ArxivImportRecoveryEvidence,
  ): Promise<void> {
    await this.operations.checkpointNativeEvidence(operationId, evidence);
  }

  async #reconcileEvidence(
    evidence: ArxivImportRecoveryEvidence,
    operationId: string,
  ): Promise<OperationExecutionOutcome> {
    let inspection: ArxivNativeInspection;
    let markerObjects;
    try {
      inspection = await this.native.inspectArxiv(evidence.source);
      markerObjects = await this.native.findArxivByOperationMarker(
        evidence.operationMarker,
      );
      const rechecked = await this.native.inspectArxiv(evidence.source);
      if (!sameCandidateSnapshot(inspection.candidates, rechecked.candidates)) {
        return unknown("The native arXiv library changed during recovery inspection");
      }
    } catch {
      return unknown("The native arXiv outcome could not be inspected completely");
    }
    if (inspection.libraryId !== evidence.libraryId) {
      return unknown("The interrupted arXiv import belongs to a different personal library");
    }
    const parentMarkers = markerObjects.filter((entry) => entry.kind === "parent");
    const attachmentMarkers = markerObjects.filter((entry) => entry.kind === "attachment");
    if (
      parentMarkers.some((entry) => entry.itemKey !== evidence.itemKey) ||
      attachmentMarkers.some(
        (entry) =>
          entry.itemKey !== evidence.itemKey ||
          entry.attachmentKey !== evidence.attachmentKey,
      ) ||
      parentMarkers.length > (evidence.itemAction === "created" ? 1 : 0) ||
      attachmentMarkers.length > (evidence.pdfAction === "downloaded" ? 1 : 0) ||
      (evidence.itemAction === "reused" && parentMarkers.length !== 0)
    ) {
      return unknown("The native operation identity markers are ambiguous");
    }

    const parent = await this.native.getArxivParent(evidence.source, evidence.itemKey);
    if (parent === undefined) {
      return unknown(
        "The historical arXiv parent is absent; it may have been deleted and will not be recreated",
      );
    }
    if (
      evidence.itemAction === "created" &&
      (parent.operationMarkers.length !== 1 ||
        parent.operationMarkers[0] !== evidence.operationMarker ||
        parent.provenanceMarkers.length !== 1 ||
        parent.provenanceMarkers[0] !== evidence.parentProvenance)
    ) {
      return unknown("The retained arXiv parent lacks the durable native import identity");
    }

    const attachment = await this.native.getArxivAttachment(
      evidence.source,
      evidence.itemKey,
      evidence.attachmentKey,
    );
    if (
      attachment !== undefined &&
      evidence.pdfAction === "downloaded" &&
      !ownedAttachmentIdentityMatches(evidence, attachment)
    ) {
      return unknown("The retained arXiv PDF lacks the durable native import identity");
    }
    if (
      evidence.pdfAction === "reused" &&
      (attachment === undefined || !expectedAttachmentIsReady(evidence, attachment))
    ) {
      return unknown("The historically reused arXiv PDF can no longer be verified exactly");
    }
    if (attachment !== undefined && expectedAttachmentIsReady(evidence, attachment)) {
      let finalInspection: ArxivNativeInspection;
      try {
        finalInspection = await this.native.inspectArxiv(evidence.source);
      } catch {
        return unknown("The readable arXiv PDF could not be rechecked completely");
      }
      if (!sameCandidateSnapshot(inspection.candidates, finalInspection.candidates)) {
        return unknown("The native arXiv library changed during PDF readback");
      }
      const matches = finalInspection.candidates.flatMap((candidate) =>
        candidate.attachments.filter(
          (entry) => entry.fingerprint === evidence.expectedPdf.fingerprint,
        ),
      );
      if (matches.length !== 1 || matches[0]?.attachmentKey !== attachment.attachmentKey) {
        return unknown("The complete native snapshot contains competing arXiv PDF identities");
      }
      const result = ready(evidence, attachment);
      try {
        await this.#checkpoint(operationId, { ...evidence, stage: "ready", result });
      } catch {
        return unknown("The verified arXiv result could not be checkpointed durably");
      }
      return { kind: "completed", data: result, verification: confirmed };
    }

    const competing = inspection.candidates.flatMap((candidate) =>
      candidate.attachments.filter(
        (entry) =>
          entry.attachmentKey !== evidence.attachmentKey &&
          (entry.fingerprint === evidence.expectedPdf.fingerprint ||
            (entry.identity === "verified" && entry.version === evidence.source.version)),
      ),
    );
    if (competing.length > 0) {
      return unknown("Another attachment now carries the requested arXiv PDF identity");
    }
    if (
      attachment !== undefined &&
      attachment.fingerprint !== null &&
      attachment.fingerprint !== evidence.expectedPdf.fingerprint
    ) {
      return unknown("The planned arXiv attachment contains unexpected bytes");
    }
    if (
      attachment === undefined &&
      (evidence.stage === "attachment_committed" || attachmentMarkers.length > 0)
    ) {
      return unknown(
        "The historical arXiv PDF attachment is absent; it may have been deleted and will not be recreated",
      );
    }
    if (evidence.pdfAction === "reused") {
      return unknown("The interrupted reuse did not leave a provable partial native outcome");
    }
    const parentWasRetained =
      (evidence.itemAction === "created" && parentMarkers.length === 1) ||
      (evidence.itemAction === "reused" && evidence.stage !== "prepared");
    if (!parentWasRetained) {
      return unknown("The interrupted import did not leave a provably retained parent outcome");
    }
    let finalInspection: ArxivNativeInspection;
    try {
      finalInspection = await this.native.inspectArxiv(evidence.source);
    } catch {
      return unknown("The retained arXiv parent could not be rechecked completely");
    }
    if (!sameCandidateSnapshot(inspection.candidates, finalInspection.candidates)) {
      return unknown("The native arXiv library changed during retained-parent readback");
    }
    return itemOnly(
      evidence,
      parent,
      "The arXiv parent is retained, but no readable matching PDF was confirmed",
    );
  }
}
