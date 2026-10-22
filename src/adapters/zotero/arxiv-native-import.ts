import { validateArxivImportSelection } from "../../core/arxiv-selection.js";
import { CoreOperationError } from "../../core/errors.js";
import type {
  ArxivImportRecoveryEvidence,
  OperationRecord,
} from "../../core/operation-record.js";
import type {
  ArxivInspectionSnapshot,
  ArxivInspectionTokenPort,
  ArxivNativeImportInput,
  ArxivNativeImportPort,
  ArxivNativeInspection,
  ArxivPdfAcquisitionPort,
  ArxivPdfStagingPort,
  StagedArxivPdf,
} from "../../ports/arxiv.js";
import type {
  OperationExecutionOutcome,
  OperationRecoveryPort,
} from "../../ports/execution.js";
import type { OperationPersistencePort } from "../../ports/operation-persistence.js";
import type {
  ArxivCandidate,
  ArxivSource,
  EnsureArxivPdfResult,
  ProtocolError,
} from "../../protocol/types.js";
import type {
  NativeArxivAttachmentRecord,
  NativeArxivParentRecord,
  ZoteroNativeApi,
} from "./native-api.js";
import {
  arxivAttachmentProvenance,
  arxivParentProvenance,
  operationIdentityMarker,
} from "./record-utils.js";

const unchecked = { storage: "not_checked", viewer: "not_checked" } as const;
const confirmed = { storage: "confirmed", viewer: "not_checked" } as const;

export interface ZoteroArxivNativeImportOptions {
  native: ZoteroNativeApi;
  acquisition: ArxivPdfAcquisitionPort;
  staging: ArxivPdfStagingPort;
  tokens: ArxivInspectionTokenPort;
  operations: OperationPersistencePort;
}

function identity(source: ArxivSource): { arxivId: string; version: number } {
  return { arxivId: source.arxivId, version: source.version };
}

function snapshot(source: ArxivSource, inspection: ArxivNativeInspection): ArxivInspectionSnapshot {
  return {
    source,
    libraryId: inspection.libraryId,
    candidates: inspection.candidates,
  };
}

function protocolError(error: unknown): ProtocolError {
  if (error instanceof CoreOperationError) return error.toProtocolError();
  return {
    code: "storage_error",
    message: error instanceof Error ? error.message : "The arXiv import failed",
    retryable: true,
  };
}

function precommitFailure(error: unknown): OperationExecutionOutcome {
  const value = protocolError(error);
  if (value.code === "unknown_outcome") {
    return { kind: "indeterminate", error: value, verification: unchecked };
  }
  if (value.code === "storage_error" || value.code === "not_found") {
    return { kind: "failed", error: value, verification: unchecked };
  }
  return { kind: "rejected", error: value, verification: unchecked };
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

function candidateMap(candidates: readonly ArxivCandidate[]): Map<string, ArxivCandidate> {
  return new Map(candidates.map((candidate) => [candidate.itemKey, candidate]));
}

function attachmentCommitMatches(
  before: readonly ArxivCandidate[],
  after: readonly ArxivCandidate[],
  itemKey: string,
  attachmentKey: string,
): boolean {
  const beforeByKey = candidateMap(before);
  const afterByKey = candidateMap(after);
  if (beforeByKey.size !== afterByKey.size) return false;
  for (const [key, previous] of beforeByKey) {
    const current = afterByKey.get(key);
    if (current === undefined) return false;
    if (key !== itemKey) {
      if (!sameCandidateSnapshot([previous], [current])) return false;
      continue;
    }
    if (current.title !== previous.title) return false;
    if (current.attachments.length !== previous.attachments.length + 1) return false;
    for (const priorAttachment of previous.attachments) {
      const retained = current.attachments.find(
        (entry) => entry.attachmentKey === priorAttachment.attachmentKey,
      );
      if (JSON.stringify(retained) !== JSON.stringify(priorAttachment)) return false;
    }
    const created = current.attachments.find((entry) => entry.attachmentKey === attachmentKey);
    if (
      created === undefined ||
      created.fingerprint !== null ||
      created.identity !== "unverified"
    ) {
      return false;
    }
  }
  return beforeByKey.has(itemKey);
}

function fileInstallMatches(
  before: readonly ArxivCandidate[],
  after: readonly ArxivCandidate[],
  itemKey: string,
  attachmentKey: string,
  expectedFingerprint: string,
  expectedVersion: number,
): boolean {
  const beforeByKey = candidateMap(before);
  const afterByKey = candidateMap(after);
  if (beforeByKey.size !== afterByKey.size) return false;
  for (const [key, previous] of beforeByKey) {
    const current = afterByKey.get(key);
    if (current === undefined) return false;
    if (key !== itemKey) {
      if (!sameCandidateSnapshot([previous], [current])) return false;
      continue;
    }
    if (current.title !== previous.title || current.attachments.length !== previous.attachments.length) {
      return false;
    }
    for (const priorAttachment of previous.attachments) {
      const installed = current.attachments.find(
        (entry) => entry.attachmentKey === priorAttachment.attachmentKey,
      );
      if (priorAttachment.attachmentKey === attachmentKey) {
        if (
          installed?.fingerprint !== expectedFingerprint ||
          installed.version !== expectedVersion ||
          installed.identity !== "verified"
        ) {
          return false;
        }
      } else if (JSON.stringify(installed) !== JSON.stringify(priorAttachment)) {
        return false;
      }
    }
  }
  return beforeByKey.has(itemKey);
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

/**
 * Coordinates one verified arXiv byte acquisition with prospective native
 * identities. The enclosing OperationCoordinator supplies profile-wide
 * serialization; this adapter persists every possible native commit boundary.
 */
export class ZoteroArxivNativeImport
  implements ArxivNativeImportPort, OperationRecoveryPort
{
  readonly #native: ZoteroNativeApi;
  readonly #acquisition: ArxivPdfAcquisitionPort;
  readonly #staging: ArxivPdfStagingPort;
  readonly #tokens: ArxivInspectionTokenPort;
  readonly #operations: OperationPersistencePort;

  constructor(options: ZoteroArxivNativeImportOptions) {
    this.#native = options.native;
    this.#acquisition = options.acquisition;
    this.#staging = options.staging;
    this.#tokens = options.tokens;
    this.#operations = options.operations;
  }

  captureAccessFence(): string {
    return this.#native.captureArxivAccessFence();
  }

  inspect(source: ArxivSource): Promise<ArxivNativeInspection> {
    return this.#native.inspectArxiv(source);
  }

  async ensure(input: ArxivNativeImportInput): Promise<OperationExecutionOutcome> {
    let staged: StagedArxivPdf | undefined;
    let evidence: ArxivImportRecoveryEvidence | undefined;
    let nativeMutationConfirmed = false;
    try {
      const initial = await this.#validatedInspection(input);
      if (input.selection.kind === "reuse") {
        const attachment = await this.#native.getArxivAttachment(
          input.source,
          input.selection.itemKey,
          input.selection.attachmentKey,
        );
        this.#native.assertArxivAccessFence(input.accessFence);
        if (
          attachment === undefined ||
          attachment.fingerprint !== input.selection.expectedFingerprint ||
          !attachment.readable ||
          attachment.pageCount === null ||
          attachment.pageCount < 1 ||
          attachment.version !== input.source.version ||
          attachment.identity !== "verified"
        ) {
          throw new CoreOperationError(
            "stale_attachment",
            "The selected arXiv PDF is not a readable verified exact-version attachment",
          );
        }
        const reuseInspection = await this.#native.inspectArxiv(input.source);
        this.#native.assertArxivAccessFence(input.accessFence);
        if (!sameCandidateSnapshot(initial.candidates, reuseInspection.candidates)) {
          throw new CoreOperationError(
            "conflict",
            "The complete canonical arXiv set changed during PDF reuse readback",
          );
        }
        evidence = this.#evidence(input, initial, {
          fingerprint: attachment.fingerprint,
          byteLength: null,
          pageCount: attachment.pageCount,
          stagingId: null,
          itemKey: input.selection.itemKey,
          itemAction: "reused",
          pdfAction: "reused",
          attachmentKey: input.selection.attachmentKey,
        });
        await this.#checkpoint(input.identity.operationId, evidence);
        const result = ready(evidence, attachment);
        await this.#checkpoint(input.identity.operationId, {
          ...evidence,
          stage: "ready",
          result,
        });
        return { kind: "completed", data: result, verification: confirmed };
      }

      const acquired = await this.#acquisition.acquire(identity(input.source));
      this.#native.assertArxivAccessFence(input.accessFence);
      if (
        acquired.source.arxivId !== input.source.arxivId ||
        acquired.source.version !== input.source.version
      ) {
        throw new CoreOperationError(
          "storage_error",
          "The acquired PDF identity does not match the resolved arXiv version",
        );
      }
      let current = await this.#validatedInspection(input, acquired.fingerprint);
      if (input.selection.kind === "attach") {
        const attachSelection = input.selection;
        const selected = current.candidates.find(
          (candidate) => candidate.itemKey === attachSelection.itemKey,
        );
        const matchingManual = selected?.attachments.filter(
          (attachment) =>
            attachment.identity === "unverified" &&
            attachment.fingerprint === acquired.fingerprint,
        ) ?? [];
        if (matchingManual.length === 1) {
          const candidate = matchingManual[0] as ArxivCandidate["attachments"][number];
          if (candidate.version === null || candidate.version === input.source.version) {
            const attachment = await this.#native.getArxivAttachment(
              input.source,
              attachSelection.itemKey,
              candidate.attachmentKey,
            );
            this.#native.assertArxivAccessFence(input.accessFence);
            evidence = this.#evidence(input, current, {
              fingerprint: acquired.fingerprint,
              byteLength: acquired.byteLength,
              pageCount: acquired.pageCount,
              stagingId: null,
              itemKey: attachSelection.itemKey,
              itemAction: "reused",
              pdfAction: "reused",
              attachmentKey: candidate.attachmentKey,
            });
            if (attachment === undefined || !expectedAttachmentIsReady(evidence, attachment)) {
              throw new CoreOperationError(
                "conflict",
                "The matching manual PDF lacks unambiguous canonical source evidence",
              );
            }
            const reuseInspection = await this.#native.inspectArxiv(input.source);
            this.#native.assertArxivAccessFence(input.accessFence);
            if (!sameCandidateSnapshot(current.candidates, reuseInspection.candidates)) {
              throw new CoreOperationError(
                "conflict",
                "The complete canonical arXiv set changed during manual PDF readback",
              );
            }
            await this.#checkpoint(input.identity.operationId, evidence);
            const result = ready(evidence, attachment);
            await this.#checkpoint(input.identity.operationId, {
              ...evidence,
              stage: "ready",
              result,
            });
            return { kind: "completed", data: result, verification: confirmed };
          }
        }
      }

      staged = await this.#staging.stage(acquired);
      this.#native.assertArxivAccessFence(input.accessFence);
      if (
        staged.source.arxivId !== input.source.arxivId ||
        staged.source.version !== input.source.version ||
        staged.fingerprint !== acquired.fingerprint ||
        staged.byteLength !== acquired.byteLength ||
        staged.pageCount !== acquired.pageCount
      ) {
        throw new CoreOperationError(
          "storage_error",
          "The staged arXiv PDF does not preserve the verified acquired identity",
        );
      }

      current = await this.#validatedInspection(input, acquired.fingerprint);
      const plan = await this.#native.planArxivImportKeys(input.selection.kind === "create");
      this.#native.assertArxivAccessFence(input.accessFence);
      const itemKey =
        input.selection.kind === "create" ? plan.itemKey : input.selection.itemKey;
      evidence = this.#evidence(input, current, {
        fingerprint: acquired.fingerprint,
        byteLength: acquired.byteLength,
        pageCount: acquired.pageCount,
        stagingId: staged.stagingId,
        itemKey,
        itemAction: input.selection.kind === "create" ? "created" : "reused",
        pdfAction: "downloaded",
        attachmentKey: plan.attachmentKey,
      });
      await this.#checkpoint(input.identity.operationId, evidence);

      let parent: NativeArxivParentRecord;
      if (input.selection.kind === "create") {
        this.#native.assertArxivAccessFence(input.accessFence);
        try {
          parent = await this.#native.createArxivParent({
            source: input.source,
            itemKey,
            operationMarker: evidence.operationMarker,
            parentProvenance: evidence.parentProvenance,
            expectedCandidates: current.candidates,
            accessFence: input.accessFence,
          });
          nativeMutationConfirmed = true;
        } catch (error) {
          if (error instanceof CoreOperationError &&
              (error.code === "conflict" || error.code === "permission_denied")) {
            return precommitFailure(error);
          }
          return await this.#reconcileEvidence(evidence, input.identity.operationId);
        }
        try {
          this.#native.assertArxivAccessFence(input.accessFence);
        } catch {
          return await this.#reconcileEvidence(evidence, input.identity.operationId);
        }
      } else {
        const loaded = await this.#native.getArxivParent(input.source, itemKey);
        this.#native.assertArxivAccessFence(input.accessFence);
        if (loaded === undefined) {
          throw new CoreOperationError(
            "conflict",
            "The selected canonical arXiv parent disappeared before attachment commit",
          );
        }
        parent = loaded;
      }
      evidence = { ...evidence, stage: "parent_committed" };
      await this.#checkpoint(input.identity.operationId, evidence);

      const beforeAttachment = await this.#native.inspectArxiv(input.source);
      this.#native.assertArxivAccessFence(input.accessFence);
      if (input.selection.kind === "attach") {
        if (!sameCandidateSnapshot(beforeAttachment.candidates, current.candidates)) {
          throw new CoreOperationError(
            "conflict",
            "The complete canonical arXiv set changed before attachment commit",
          );
        }
      } else if (
        beforeAttachment.candidates.length !== 1 ||
        beforeAttachment.candidates[0]?.itemKey !== itemKey ||
        beforeAttachment.candidates[0]?.itemRevision !== parent.itemRevision
      ) {
        return unknown(
          "The complete canonical arXiv set changed while the new parent was committed",
        );
      }
      this.#native.assertArxivAccessFence(input.accessFence);
      try {
        await this.#native.createArxivAttachment({
          source: input.source,
          itemKey,
          attachmentKey: evidence.attachmentKey,
          operationMarker: evidence.operationMarker,
          attachmentProvenance: evidence.attachmentProvenance,
          expectedCandidates: beforeAttachment.candidates,
          accessFence: input.accessFence,
        });
        nativeMutationConfirmed = true;
      } catch (error) {
        if (error instanceof CoreOperationError &&
            (error.code === "conflict" || error.code === "permission_denied") &&
            !nativeMutationConfirmed) {
          return precommitFailure(error);
        }
        return await this.#reconcileEvidence(evidence, input.identity.operationId);
      }
      try {
        this.#native.assertArxivAccessFence(input.accessFence);
      } catch {
        return await this.#reconcileEvidence(evidence, input.identity.operationId);
      }
      const parentAfterAttachment = await this.#native.getArxivParent(
        input.source,
        itemKey,
      );
      try {
        this.#native.assertArxivAccessFence(input.accessFence);
      } catch {
        return await this.#reconcileEvidence(evidence, input.identity.operationId);
      }
      if (
        parentAfterAttachment === undefined ||
        parentAfterAttachment.metadataRevision !== parent.metadataRevision
      ) {
        return unknown(
          "The canonical arXiv parent metadata changed while the attachment was committed",
        );
      }
      evidence = { ...evidence, stage: "attachment_committed" };
      await this.#checkpoint(input.identity.operationId, evidence);

      const beforeInstall = await this.#native.inspectArxiv(input.source);
      this.#native.assertArxivAccessFence(input.accessFence);
      if (
        !attachmentCommitMatches(
          beforeAttachment.candidates,
          beforeInstall.candidates,
          itemKey,
          evidence.attachmentKey,
        )
      ) {
        return unknown(
          "The complete canonical arXiv set changed while the attachment record was committed",
        );
      }
      const parentBeforeInstall = await this.#native.getArxivParent(input.source, itemKey);
      this.#native.assertArxivAccessFence(input.accessFence);
      if (
        parentBeforeInstall === undefined ||
        parentBeforeInstall.metadataRevision !== parent.metadataRevision ||
        parentBeforeInstall.itemRevision !== parentAfterAttachment.itemRevision
      ) {
        return unknown("The canonical arXiv parent changed before file installation");
      }
      let attachment: NativeArxivAttachmentRecord;
      try {
        attachment = await this.#native.installArxivPdf({
          source: input.source,
          itemKey,
          attachmentKey: evidence.attachmentKey,
          stagedPdf: staged,
          expectedCandidates: beforeInstall.candidates,
          accessFence: input.accessFence,
        });
      } catch {
        return await this.#reconcileEvidence(evidence, input.identity.operationId);
      }
      try {
        this.#native.assertArxivAccessFence(input.accessFence);
      } catch {
        return await this.#reconcileEvidence(evidence, input.identity.operationId);
      }
      if (
        !expectedAttachmentIsReady(evidence, attachment) ||
        attachment.pageCount !== acquired.pageCount ||
        attachment.operationMarkers.length !== 1 ||
        attachment.operationMarkers[0] !== evidence.operationMarker ||
        attachment.provenanceMarkers.length !== 1 ||
        attachment.provenanceMarkers[0] !== evidence.attachmentProvenance
      ) {
        return await this.#reconcileEvidence(evidence, input.identity.operationId);
      }
      const finalParent = await this.#native.getArxivParent(input.source, itemKey);
      try {
        this.#native.assertArxivAccessFence(input.accessFence);
      } catch {
        return await this.#reconcileEvidence(evidence, input.identity.operationId);
      }
      if (
        finalParent === undefined ||
        finalParent.metadataRevision !== parent.metadataRevision
      ) {
        return unknown("The canonical arXiv parent metadata changed during PDF readback");
      }
      const finalInspection = await this.#native.inspectArxiv(input.source);
      try {
        this.#native.assertArxivAccessFence(input.accessFence);
      } catch {
        return await this.#reconcileEvidence(evidence, input.identity.operationId);
      }
      if (
        !fileInstallMatches(
          beforeInstall.candidates,
          finalInspection.candidates,
          itemKey,
          evidence.attachmentKey,
          evidence.expectedPdf.fingerprint,
          evidence.source.version,
        )
      ) {
        return unknown("The complete canonical arXiv set changed during PDF installation");
      }
      const matching = finalInspection.candidates.flatMap((candidate) =>
        candidate.attachments.filter(
          (candidateAttachment) =>
            candidateAttachment.fingerprint === evidence?.expectedPdf.fingerprint,
        ),
      );
      if (matching.length !== 1 || matching[0]?.attachmentKey !== evidence.attachmentKey) {
        return unknown(
          "The complete native snapshot contains an ambiguous duplicate of the imported arXiv PDF",
        );
      }
      const result = ready(evidence, attachment);
      await this.#checkpoint(input.identity.operationId, {
        ...evidence,
        stage: "ready",
        result,
      });
      return { kind: "completed", data: result, verification: confirmed };
    } catch (error) {
      if (nativeMutationConfirmed && evidence !== undefined) {
        return await this.#reconcileEvidence(evidence, input.identity.operationId);
      }
      return precommitFailure(error);
    } finally {
      if (staged !== undefined) {
        try {
          await this.#staging.discard(staged.stagingId);
        } catch {
          // Owned staging cleanup cannot change an already classified native outcome.
        }
      }
    }
  }

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
    try {
      if (evidence.stage === "ready" && evidence.result !== undefined) {
        return { kind: "completed", data: evidence.result, verification: confirmed };
      }
      return await this.#reconcileEvidence(evidence, record.operationId);
    } finally {
      if (evidence.expectedPdf.stagingId !== null) {
        try {
          await this.#staging.discard(evidence.expectedPdf.stagingId);
        } catch {
          // Recovery never resumes a staged download; cleanup remains best effort.
        }
      }
    }
  }

  async #validatedInspection(
    input: ArxivNativeImportInput,
    expectedPdfFingerprint?: string,
  ): Promise<ArxivNativeInspection> {
    this.#native.assertArxivAccessFence(input.accessFence);
    const inspection = await this.#native.inspectArxiv(input.source);
    this.#native.assertArxivAccessFence(input.accessFence);
    const matches = await this.#tokens.matches(
      input.inspectionToken,
      snapshot(input.source, inspection),
    );
    this.#native.assertArxivAccessFence(input.accessFence);
    if (!matches) {
      throw new CoreOperationError(
        "conflict",
        "The complete arXiv inspection snapshot changed; inspect again before import",
      );
    }
    validateArxivImportSelection(
      input.source,
      inspection.candidates,
      input.selection,
      expectedPdfFingerprint === undefined ? {} : { expectedPdfFingerprint },
    );
    return inspection;
  }

  #evidence(
    input: ArxivNativeImportInput,
    inspection: ArxivNativeInspection,
    values: {
      fingerprint: string;
      byteLength: number | null;
      pageCount: number | null;
      stagingId: string | null;
      itemKey: string;
      itemAction: "created" | "reused";
      pdfAction: "downloaded" | "reused";
      attachmentKey: string;
    },
  ): ArxivImportRecoveryEvidence {
    return {
      kind: "arxiv_import",
      stage: "prepared",
      source: input.source,
      libraryId: inspection.libraryId,
      inspectionToken: input.inspectionToken,
      selection: input.selection,
      initialCandidates: inspection.candidates,
      expectedPdf: {
        fingerprint: values.fingerprint,
        byteLength: values.byteLength,
        pageCount: values.pageCount,
        stagingId: values.stagingId,
      },
      itemKey: values.itemKey,
      itemAction: values.itemAction,
      pdfAction: values.pdfAction,
      attachmentKey: values.attachmentKey,
      operationMarker: operationIdentityMarker(input.identity),
      parentProvenance: arxivParentProvenance(input.source),
      attachmentProvenance: arxivAttachmentProvenance(
        input.source,
        values.fingerprint,
      ),
    };
  }

  async #checkpoint(
    operationId: string,
    evidence: ArxivImportRecoveryEvidence,
  ): Promise<void> {
    await this.#operations.checkpointNativeEvidence(operationId, evidence);
  }

  async #reconcileEvidence(
    evidence: ArxivImportRecoveryEvidence,
    operationId: string,
  ): Promise<OperationExecutionOutcome> {
    let inspection: ArxivNativeInspection;
    let markerObjects;
    try {
      inspection = await this.#native.inspectArxiv(evidence.source);
      markerObjects = await this.#native.findArxivByOperationMarker(
        evidence.operationMarker,
      );
      const rechecked = await this.#native.inspectArxiv(evidence.source);
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

    const parent = await this.#native.getArxivParent(evidence.source, evidence.itemKey);
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

    const attachment = await this.#native.getArxivAttachment(
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
        finalInspection = await this.#native.inspectArxiv(evidence.source);
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
      finalInspection = await this.#native.inspectArxiv(evidence.source);
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
