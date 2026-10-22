import type {
  ArxivImportRecoveryEvidence,
  NativeOperationEvidence,
  OperationRecord,
} from "../../core/operation-record.js";
import type {
  MutationSerializationPort,
  OperationClaim,
  OperationPersistencePort,
} from "../../ports/operation-persistence.js";
import type { OperationState } from "../../protocol/types.js";
import {
  isEnsureArxivReadyResult,
  validateArxivSource,
} from "../../protocol/validation.js";

export interface AtomicTextFile {
  /** Returns undefined when the file does not exist. */
  readText(): Promise<string | undefined>;
  writeTextAtomic(text: string): Promise<void>;
}

export interface DurableOperationStoreOptions {
  generateProfileId: () => string;
}

interface StoreDocument {
  schemaVersion: 1;
  profileId: string;
  operations: Record<string, OperationRecord>;
}

function operationDictionary(): Record<string, OperationRecord> {
  return Object.create(null) as Record<string, OperationRecord>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ownOperation(
  operations: Record<string, OperationRecord>,
  operationId: string,
): OperationRecord | undefined {
  return Object.hasOwn(operations, operationId) ? operations[operationId] : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index]);
}

function validSelection(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.kind === "create") return hasOnlyKeys(value, ["kind"]);
  if (value.kind === "attach") {
    return hasOnlyKeys(value, ["kind", "itemKey", "expectedItemRevision"]) &&
      nonemptyString(value.itemKey) && nonemptyString(value.expectedItemRevision);
  }
  return value.kind === "reuse" &&
    hasOnlyKeys(value, ["kind", "itemKey", "attachmentKey", "expectedFingerprint"]) &&
    nonemptyString(value.itemKey) &&
    nonemptyString(value.attachmentKey) &&
    nonemptyString(value.expectedFingerprint);
}

function validCandidates(value: unknown): boolean {
  return Array.isArray(value) && value.every((candidate) =>
    isObject(candidate) &&
    hasOnlyKeys(candidate, ["itemKey", "itemRevision", "title", "attachments"]) &&
    nonemptyString(candidate.itemKey) &&
    nonemptyString(candidate.itemRevision) &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.attachments) &&
    candidate.attachments.every((attachment) =>
      isObject(attachment) &&
      hasOnlyKeys(attachment, ["attachmentKey", "fingerprint", "version", "identity"]) &&
      nonemptyString(attachment.attachmentKey) &&
      (attachment.fingerprint === null || nonemptyString(attachment.fingerprint)) &&
      (attachment.version === null ||
        (Number.isSafeInteger(attachment.version) && (attachment.version as number) > 0)) &&
      (attachment.identity === "verified" || attachment.identity === "unverified")
    )
  );
}

function assertNativeEvidenceShape(value: unknown, operationId: string): void {
  if (!isObject(value) || value.kind !== "arxiv_import") {
    throw new Error(`Durable operation '${operationId}' has invalid native recovery evidence`);
  }
  const evidence = value as unknown as ArxivImportRecoveryEvidence;
  let sourceValid = true;
  try {
    validateArxivSource(evidence.source, `$operation[${operationId}].nativeEvidence.source`);
  } catch {
    sourceValid = false;
  }
  const byteLengthValid = evidence.expectedPdf?.byteLength === null ||
    (Number.isSafeInteger(evidence.expectedPdf?.byteLength) &&
      (evidence.expectedPdf?.byteLength ?? 0) > 0);
  const pageCountValid = evidence.expectedPdf?.pageCount === null ||
    (Number.isSafeInteger(evidence.expectedPdf?.pageCount) &&
      (evidence.expectedPdf?.pageCount ?? 0) > 0);
  const stagingIdValid = evidence.expectedPdf?.stagingId === null ||
    nonemptyString(evidence.expectedPdf?.stagingId);
  const selectionActionValid =
    (evidence.selection?.kind === "create" && evidence.itemAction === "created") ||
    ((evidence.selection?.kind === "attach" || evidence.selection?.kind === "reuse") &&
      evidence.itemAction === "reused");
  const reuseFingerprintValid = evidence.selection?.kind !== "reuse" ||
    evidence.selection.expectedFingerprint === evidence.expectedPdf?.fingerprint;
  const selectionTargetValid = evidence.selection?.kind === "create" ||
    (evidence.selection?.itemKey === evidence.itemKey &&
      (evidence.selection.kind !== "reuse" ||
        evidence.selection.attachmentKey === evidence.attachmentKey));
  const expectedPdfShapeValid = isObject(evidence.expectedPdf) &&
    hasOnlyKeys(evidence.expectedPdf, ["fingerprint", "byteLength", "pageCount", "stagingId"]);
  const acquisitionEvidenceValid = evidence.selection?.kind === "reuse"
    ? evidence.expectedPdf?.byteLength === null &&
      evidence.expectedPdf?.stagingId === null &&
      evidence.expectedPdf?.pageCount !== null &&
      evidence.stage !== "parent_committed" &&
      evidence.stage !== "attachment_committed"
    : evidence.expectedPdf?.byteLength !== null &&
      evidence.expectedPdf?.pageCount !== null &&
      evidence.expectedPdf?.stagingId !== null;
  const readyResultValid = evidence.stage !== "ready" || (
    isEnsureArxivReadyResult(evidence.result) &&
    evidence.result.source.arxivId === evidence.source.arxivId &&
    evidence.result.source.version === evidence.source.version &&
    evidence.result.libraryId === evidence.libraryId &&
    evidence.result.itemKey === evidence.itemKey &&
    evidence.result.itemAction === evidence.itemAction &&
    evidence.result.attachmentKey === evidence.attachmentKey &&
    evidence.result.attachmentFingerprint === evidence.expectedPdf.fingerprint &&
    evidence.result.pdfAction === (evidence.selection.kind === "reuse" ? "reused" : "downloaded")
  );
  if (
    !["prepared", "parent_committed", "attachment_committed", "ready"].includes(evidence.stage) ||
    !sourceValid ||
    !nonemptyString(evidence.libraryId) ||
    !nonemptyString(evidence.inspectionToken) ||
    !validSelection(evidence.selection) ||
    !validCandidates(evidence.initialCandidates) ||
    !expectedPdfShapeValid ||
    !nonemptyString(evidence.expectedPdf.fingerprint) ||
    !byteLengthValid ||
    !pageCountValid ||
    !stagingIdValid ||
    !nonemptyString(evidence.itemKey) ||
    !nonemptyString(evidence.attachmentKey) ||
    !nonemptyString(evidence.operationMarker) ||
    !nonemptyString(evidence.parentProvenance) ||
    !nonemptyString(evidence.attachmentProvenance) ||
    (evidence.itemAction !== "created" && evidence.itemAction !== "reused") ||
    !selectionActionValid ||
    !selectionTargetValid ||
    !reuseFingerprintValid ||
    !acquisitionEvidenceValid ||
    (evidence.stage === "ready" && !isObject(evidence.result)) ||
    (evidence.stage !== "ready" && evidence.result !== undefined) ||
    !readyResultValid
  ) {
    throw new Error(`Durable operation '${operationId}' has invalid native recovery evidence`);
  }
}

function assertRecordShape(value: unknown, operationId: string): asserts value is OperationRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Durable operation '${operationId}' is not an object`);
  }
  const record = value as Partial<OperationRecord>;
  if (
    record.protocolVersion !== 1 ||
    record.operationId !== operationId ||
    typeof record.requestDigest !== "string" ||
    record.requestDigest.length === 0 ||
    typeof record.operation !== "string" ||
    typeof record.mutation !== "boolean" ||
    typeof record.state !== "string" ||
    record.response === null ||
    typeof record.response !== "object" ||
    record.response.operationId !== operationId ||
    record.response.state !== record.state
  ) {
    throw new Error(`Durable operation '${operationId}' is invalid`);
  }
  if (record.nativeEvidence !== undefined) {
    if (record.operation !== "ensure_arxiv_pdf" || record.state === "queued") {
      throw new Error(`Durable operation '${operationId}' has misplaced native recovery evidence`);
    }
    assertNativeEvidenceShape(record.nativeEvidence, operationId);
  }
}

function parseDocument(text: string): StoreDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`The durable operation store is corrupt: ${detail}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The durable operation store root must be an object");
  }
  const document = value as Partial<StoreDocument>;
  if (
    document.schemaVersion !== 1 ||
    typeof document.profileId !== "string" ||
    document.profileId.trim().length === 0 ||
    document.operations === null ||
    typeof document.operations !== "object" ||
    Array.isArray(document.operations)
  ) {
    throw new Error("The durable operation store has an unsupported or invalid shape");
  }
  const operations = operationDictionary();
  for (const [operationId, record] of Object.entries(document.operations)) {
    assertRecordShape(record, operationId);
    operations[operationId] = record;
  }
  return { schemaVersion: 1, profileId: document.profileId, operations };
}

function assertTransitionIdentity(current: OperationRecord, next: OperationRecord): void {
  if (
    next.protocolVersion !== current.protocolVersion ||
    next.operationId !== current.operationId ||
    next.requestDigest !== current.requestDigest ||
    next.operation !== current.operation ||
    next.profileId !== current.profileId ||
    next.mutation !== current.mutation ||
    JSON.stringify(next.nativeEvidence ?? null) !== JSON.stringify(current.nativeEvidence ?? null)
  ) {
    throw new Error("A durable transition cannot replace immutable operation identity");
  }
  if (next.response.operationId !== next.operationId || next.response.state !== next.state) {
    throw new Error("A durable transition response must match the operation ID and state");
  }
}

const ARXIV_STAGE_ORDER: Record<ArxivImportRecoveryEvidence["stage"], number> = {
  prepared: 0,
  parent_committed: 1,
  attachment_committed: 2,
  ready: 3,
};

function immutableArxivEvidence(evidence: ArxivImportRecoveryEvidence): object {
  const { stage: _stage, result: _result, ...immutable } = evidence;
  return immutable;
}

function assertEvidenceProgression(
  current: NativeOperationEvidence | undefined,
  next: NativeOperationEvidence,
): void {
  if (current === undefined) {
    if (next.stage !== "prepared") {
      throw new Error("The first native recovery checkpoint must be prepared");
    }
    return;
  }
  if (
    JSON.stringify(immutableArxivEvidence(current)) !==
    JSON.stringify(immutableArxivEvidence(next))
  ) {
    throw new Error("Native recovery evidence identity is immutable after its first checkpoint");
  }
  if (ARXIV_STAGE_ORDER[next.stage] < ARXIV_STAGE_ORDER[current.stage]) {
    throw new Error("Native recovery evidence cannot move to an earlier stage");
  }
  if (
    ARXIV_STAGE_ORDER[next.stage] === ARXIV_STAGE_ORDER[current.stage] &&
    JSON.stringify(next) !== JSON.stringify(current)
  ) {
    throw new Error("A native recovery stage cannot be replaced with different evidence");
  }
}

/**
 * One small JSON document kept below the Zotero profile directory. The file
 * boundary performs atomic replacement; this class serializes read/modify/write
 * sequences so claims and optimistic transitions cannot race in one plugin.
 */
export class DurableOperationStore implements OperationPersistencePort {
  readonly #file: AtomicTextFile;
  readonly #options: DurableOperationStoreOptions;
  #tail: Promise<void> = Promise.resolve();

  constructor(file: AtomicTextFile, options: DurableOperationStoreOptions) {
    this.#file = file;
    this.#options = options;
  }

  async profileId(): Promise<string> {
    return this.#exclusive(async () => (await this.#loadOrCreate()).profileId);
  }

  async claim(initial: OperationRecord): Promise<OperationClaim> {
    assertRecordShape(initial, initial.operationId);
    return this.#exclusive(async () => {
      const document = await this.#loadOrCreate();
      const existing = ownOperation(document.operations, initial.operationId);
      if (existing !== undefined) {
        return { kind: "existing", record: clone(existing) };
      }
      document.operations[initial.operationId] = clone(initial);
      await this.#write(document);
      return { kind: "created", record: clone(initial) };
    });
  }

  async load(operationId: string): Promise<OperationRecord | undefined> {
    return this.#exclusive(async () => {
      const document = await this.#loadOrCreate();
      const record = ownOperation(document.operations, operationId);
      return record === undefined ? undefined : clone(record);
    });
  }

  async listPending(): Promise<OperationRecord[]> {
    return this.#exclusive(async () => {
      const document = await this.#loadOrCreate();
      return Object.values(document.operations)
        .filter((record) => record.state === "queued" || record.state === "running")
        .sort((left, right) => left.operationId.localeCompare(right.operationId))
        .map((record) => clone(record));
    });
  }

  async checkpointNativeEvidence(
    operationId: string,
    evidence: NativeOperationEvidence,
  ): Promise<OperationRecord> {
    assertNativeEvidenceShape(evidence, operationId);
    return this.#exclusive(async () => {
      const document = await this.#loadOrCreate();
      const current = ownOperation(document.operations, operationId);
      if (current === undefined) {
        throw new Error(`Durable operation '${operationId}' does not exist`);
      }
      if (
        current.operation !== "ensure_arxiv_pdf" ||
        !current.mutation ||
        current.state !== "running"
      ) {
        throw new Error("Native recovery evidence requires a running arXiv import");
      }
      assertEvidenceProgression(current.nativeEvidence, evidence);
      if (JSON.stringify(current.nativeEvidence ?? null) === JSON.stringify(evidence)) {
        return clone(current);
      }
      const next: OperationRecord = { ...current, nativeEvidence: clone(evidence) };
      document.operations[operationId] = clone(next);
      await this.#write(document);
      return clone(next);
    });
  }

  async transition(
    operationId: string,
    expectedState: OperationState,
    next: OperationRecord,
  ): Promise<OperationRecord> {
    assertRecordShape(next, operationId);
    return this.#exclusive(async () => {
      const document = await this.#loadOrCreate();
      const current = ownOperation(document.operations, operationId);
      if (current === undefined) {
        throw new Error(`Durable operation '${operationId}' does not exist`);
      }
      if (current.state !== expectedState) {
        throw new Error(
          `Durable operation '${operationId}' is in state '${current.state}', not expected state '${expectedState}'`,
        );
      }
      assertTransitionIdentity(current, next);
      document.operations[operationId] = clone(next);
      await this.#write(document);
      return clone(next);
    });
  }

  async #loadOrCreate(): Promise<StoreDocument> {
    const text = await this.#file.readText();
    if (text !== undefined) return parseDocument(text);

    const profileId = this.#options.generateProfileId();
    if (typeof profileId !== "string" || profileId.trim().length === 0) {
      throw new Error("generateProfileId() returned an empty profile ID");
    }
    const document: StoreDocument = {
      schemaVersion: 1,
      profileId,
      operations: operationDictionary(),
    };
    await this.#write(document);
    return document;
  }

  async #write(document: StoreDocument): Promise<void> {
    await this.#file.writeTextAtomic(`${JSON.stringify(document)}\n`);
  }

  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

/** Per-profile FIFO serialization, including rejected/throwing mutation bodies. */
export class KeyedMutationSerializer implements MutationSerializationPort {
  readonly #tails = new Map<string, Promise<void>>();

  async runExclusive<T>(profileId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(profileId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    this.#tails.set(profileId, current);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.#tails.get(profileId) === current) {
        void current.finally(() => {
          if (this.#tails.get(profileId) === current) this.#tails.delete(profileId);
        });
      }
    }
  }
}
