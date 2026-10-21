import type { OperationRecord } from "../../core/operation-record.js";
import type {
  MutationSerializationPort,
  OperationClaim,
  OperationPersistencePort,
} from "../../ports/operation-persistence.js";
import type { OperationState } from "../../protocol/types.js";

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
    next.mutation !== current.mutation
  ) {
    throw new Error("A durable transition cannot replace immutable operation identity");
  }
  if (next.response.operationId !== next.operationId || next.response.state !== next.state) {
    throw new Error("A durable transition response must match the operation ID and state");
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
