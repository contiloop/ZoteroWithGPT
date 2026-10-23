import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";
import { JSDOM } from "jsdom";

import { CoreOperationError, OperationCoordinator } from "../../dist/core/index.js";
import { ZoteroAnchorResolver } from "../../dist/adapters/anchors/index.js";
import { ZoteroArxivNativeImport } from "../../dist/adapters/zotero/arxiv-native-import.js";
import {
  ARXIV_PROVENANCE_RELATION_PREDICATE,
  MutableZoteroAccessGate,
  DomPurifyNativeNoteContentPolicy,
  OPERATION_RELATION_PREDICATE,
  ZoteroLibraryAdapter,
  arxivAttachmentProvenance,
  arxivParentProvenance,
  createZoteroNativeApi,
} from "../../dist/adapters/zotero/index.js";
import { NativeOperationExecutor } from "../../dist/plugin/execute.js";
import { validateProtocolRequest } from "../../dist/protocol/index.js";

function visibleDocument(querySelector = () => null) {
  const body = {
    isConnected: true,
    parentElement: null,
    getClientRects() { return { length: 1 }; },
    getBoundingClientRect() { return { left: 0, right: 800, top: 0, bottom: 600 }; },
  };
  return {
    hidden: false,
    visibilityState: "visible",
    body,
    documentElement: { clientWidth: 800, clientHeight: 600 },
    defaultView: {
      innerWidth: 800,
      innerHeight: 600,
      getComputedStyle(node) {
        return {
          display: node.computedStyle?.display ?? "block",
          visibility: node.computedStyle?.visibility ?? "visible",
          opacity: node.computedStyle?.opacity ?? "1",
          contentVisibility: node.computedStyle?.contentVisibility ?? "visible",
          overflow: node.computedStyle?.overflow ?? "visible",
          overflowX: node.computedStyle?.overflowX ?? "visible",
          overflowY: node.computedStyle?.overflowY ?? "visible",
        };
      },
    },
    querySelector,
  };
}

function laidOutNode(ownerDocument, rect = { left: 0, right: 800, top: 0, bottom: 600 }) {
  return {
    ownerDocument,
    isConnected: true,
    parentElement: null,
    computedStyle: {},
    getClientRects() { return { length: 1 }; },
    getBoundingClientRect() { return rect; },
  };
}

class FakeItem {
  constructor(host, itemType, values = {}, requireProspectivePrimaryData = false) {
    this.host = host;
    this.itemType = itemType;
    this.requireProspectivePrimaryData = requireProspectivePrimaryData;
    this.prospectivePrimaryDataLoaded = !requireProspectivePrimaryData;
    this.id = values.id;
    this.key = values.key;
    this.libraryID = values.libraryID ?? 1;
    this.parentItemID = values.parentItemID;
    this.version = values.version ?? 1;
    this.dateModified = values.dateModified ?? "2026-10-21 10:00:00";
    this._annotationComment = null;
    this.relations = new Map();
    Object.assign(this, values);
  }

  get annotationComment() { return this._annotationComment; }
  set annotationComment(value) {
    // Mirrors Zotero 10.0.6's public annotation-property setter.
    if (typeof value === "string") {
      value = value.trim().normalize();
      if (value === "") value = null;
    }
    this._annotationComment = value;
  }

  async loadPrimaryData() {
    assert.equal(typeof this.libraryID, "number");
    assert.equal(typeof this.key, "string");
    await this.host.onLoadPrimaryData?.(this);
    const existing = [...this.host.items.values()].find(
      (item) => item !== this && item.libraryID === this.libraryID && item.key === this.key,
    );
    if (existing) this.id = existing.id;
    this.prospectivePrimaryDataLoaded = true;
    this.host.primaryDataLoads.push({ itemType: this.itemType, key: this.key });
  }
  async loadAllData() {
    await this.host.onLoadAllData?.(this);
    if (this.isNote() && typeof this.note === "string") {
      const match = this.note.match(/^<div class="zotero-note znv[0-9]+">([\s\S]*)<\/div>$/u);
      if (match) this.note = match[1];
    }
  }
  assertPrimaryDataLoaded() {
    if (
      this.requireProspectivePrimaryData &&
      typeof this.key === "string" &&
      !this.prospectivePrimaryDataLoaded
    ) {
      const error = new Error(
        `'primaryData' not loaded for item (${String(this.id ?? null)}/${String(this.libraryID)}/${this.key})`,
      );
      error.name = "Zotero.Exception.UnloadedDataException";
      throw error;
    }
  }
  get parentID() { return this.parentItemID; }
  set parentID(value) {
    this.assertPrimaryDataLoaded();
    this.parentItemID = value;
  }
  isPDFAttachment() { return this.itemType === "attachment"; }
  isRegularItem() { return this.itemType === "journalArticle" || this.itemType === "preprint"; }
  isAnnotation() { return this.itemType === "annotation"; }
  isNote() { return this.itemType === "note"; }
  isEditable() { return true; }
  getField(field) { return this.fields?.[field] ?? ""; }
  setField(field, value) {
    this.assertPrimaryDataLoaded();
    this.fields ??= {};
    this.fields[field] = value;
  }
  getDisplayTitle() { return this.fields?.title ?? ""; }
  getCreators() { return structuredClone(this.creators ?? []); }
  setCreators(creators) {
    this.assertPrimaryDataLoaded();
    this.creators = structuredClone(creators);
  }
  getCollections() { return [...(this.collections ?? [])]; }
  getAttachments(includeTrashed = false) {
    return [...this.host.items.values()]
      .filter((item) =>
        item.isPDFAttachment() &&
        item.parentItemID === this.id &&
        (includeTrashed || item.deleted !== true),
      )
      .map((item) => item.id);
  }
  getFilePath() {
    if (this.filePath === false) return false;
    if (typeof this.filePath === "string") return this.filePath;
    if (typeof this.attachmentPath === "string" && this.attachmentPath.startsWith("storage:")) {
      return `/storage/${this.key}/${this.attachmentPath.slice("storage:".length)}`;
    }
    return "/fixture/paper.pdf";
  }
  getFilePathAsync() {
    return Promise.resolve(this.getFilePath());
  }
  getAnnotations() {
    return [...this.host.items.values()].filter(
      (item) => item.isAnnotation() && item.parentItemID === this.id,
    );
  }
  getNotes() {
    return [...this.host.items.values()]
      .filter((item) => item.isNote() && item.parentItemID === this.id)
      .map((item) => item.id);
  }
  getRelationsByPredicate(predicate) { return [...(this.relations.get(predicate) ?? [])]; }
  addRelation(predicate, value) {
    this.assertPrimaryDataLoaded();
    const values = this.relations.get(predicate) ?? [];
    if (!values.includes(value)) values.push(value);
    this.relations.set(predicate, values);
  }
  setNote(content) {
    this.note = content
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
      .trim();
  }
  getNote() { return this.note; }
  getNoteTitle() { return "Fixture note"; }
  async save() {
    assert.equal(this.host.db.inTransaction(), true);
    await this.host.onItemSave?.(this);
    if (!this.id) this.id = this.host.nextId++;
    if (!this.key) this.key = `KEY${String(this.id).padStart(5, "0")}`;
    this.prospectivePrimaryDataLoaded = true;
    this.version += 1;
    this.host.bumpClientVersion();
    this.host.items.set(this.id, this);
    this.host.savedSnapshots.push({
      key: this.key,
      comment: this.annotationComment,
      relations: structuredClone(Object.fromEntries(this.relations)),
    });
    return this.id;
  }
  async saveTx() {
    return this.host.db.executeTransaction(() => this.save());
  }
}

class MemoryOperationStore {
  records = new Map();

  async claim(record) {
    const existing = this.records.get(record.operationId);
    if (existing) return { kind: "existing", record: structuredClone(existing) };
    this.records.set(record.operationId, structuredClone(record));
    return { kind: "created", record: structuredClone(record) };
  }

  async load(operationId) {
    const record = this.records.get(operationId);
    return record === undefined ? undefined : structuredClone(record);
  }

  async transition(operationId, from, next) {
    const current = this.records.get(operationId);
    if (current?.state !== from) throw new Error("optimistic transition failed");
    this.records.set(operationId, structuredClone(next));
    return structuredClone(next);
  }
}

class InlineMutationSerializer {
  async runExclusive(_profileId, work) { return work(); }
}

class Sha256Digest {
  async digest(bytes) {
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  }
}

function fixtureEnvironment() {
  const readerRealmRequest = Symbol("readerRealmRequest");
  const readerRealmPosition = Symbol("readerRealmPosition");
  const host = {
    items: new Map(),
    nextId: 10,
    savedSnapshots: [],
    diskBytes: new Uint8Array([1, 2, 3, 4]),
    readerBytes: new Uint8Array([1, 2, 3, 4]),
    requireClonedAnnotationMeta: false,
    annotationMetaClones: 0,
    onLoadAllData: undefined,
    onLoadPrimaryData: undefined,
    primaryDataLoads: [],
    generatedKeyNumber: 1,
    diskByPath: new Map(),
    stagedBytes: new Map(),
    clientVersion: 1,
    transactionWaiters: 0,
    onItemsGetAll: undefined,
    onItemSave: undefined,
    afterTransactionCommit: undefined,
    transactionStarts: 0,
    freshReads: [],
    ioReadPaths: [],
    libraries: [],
  };
  let transactionTail = Promise.resolve();
  let transactionCount = 0;
  let transactionVersionIncremented = false;
  host.db = {
    active: false,
    async executeTransaction(work) {
      host.transactionStarts += 1;
      const prior = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      transactionCount += 1;
      const queued = transactionCount > 1;
      if (queued) host.transactionWaiters += 1;
      await prior;
      if (queued) host.transactionWaiters -= 1;
      this.active = true;
      transactionVersionIncremented = false;
      const itemIdsBefore = new Set(host.items.keys());
      const snapshotsBefore = host.savedSnapshots.length;
      const clientVersionBefore = host.clientVersion;
      let result;
      let committed = false;
      try {
        result = await work();
        committed = true;
      } catch (error) {
        for (const itemId of host.items.keys()) {
          if (!itemIdsBefore.has(itemId)) host.items.delete(itemId);
        }
        host.savedSnapshots.length = snapshotsBefore;
        host.clientVersion = clientVersionBefore;
        throw error;
      } finally {
        this.active = false;
        transactionCount -= 1;
        release();
      }
      if (committed) await host.afterTransactionCommit?.();
      return result;
    },
    inTransaction() { return this.active; },
  };
  host.bumpClientVersion = () => {
    assert.equal(host.db.inTransaction(), true);
    if (!transactionVersionIncremented) {
      host.clientVersion += 1;
      transactionVersionIncremented = true;
    }
  };
  const personalLibrary = {
    libraryID: 1,
    get clientVersion() { return host.clientVersion; },
    async waitForDataLoad() {},
  };
  host.libraries.push(personalLibrary);
  const paper = new FakeItem(host, "journalArticle", {
    id: 1,
    key: "ITEM0001",
    fields: { title: "Fixture paper" },
  });
  const attachment = new FakeItem(host, "attachment", {
    id: 2,
    key: "ATTACH01",
    parentItemID: 1,
    attachmentContentType: "application/pdf",
    fields: { title: "Fixture PDF" },
  });
  host.items.set(paper.id, paper);
  host.items.set(attachment.id, attachment);

  const pageData = {
    viewBox: [0, 0, 600, 800],
    chars: [
      { u: "A", rect: [10, 20, 17, 30], inlineRect: [10, 20, 17, 30] },
    ],
  };
  const ownerDocument = visibleDocument();
  const frame = laidOutNode(ownerDocument);
  const tabContainer = laidOutNode(ownerDocument);
  const reader = {
    itemID: 2,
    tabID: "reader-tab-1",
    _iframe: frame,
    _tabContainer: tabContainer,
    _window: { Zotero_Tabs: { selectedID: "reader-tab-1" } },
    _iframeWindow: { document: visibleDocument(), frameElement: frame },
    _initPromise: Promise.resolve(),
    _internalReader: {
      _state: { annotations: [] },
      _primaryView: {
        initializedPromise: Promise.resolve(),
        getAnnotationMeta(position) {
          const pageIndex =
            !host.requireClonedAnnotationMeta || position?.[readerRealmPosition] === true
              ? position?.pageIndex
              : undefined;
          return {
            sortIndex: `${pageIndex.toString().padStart(5, "0")}|000001|00020`,
            pageLabel: "1",
          };
        },
        _selectionRanges: [],
        _iframeWindow: {
          PDFViewerApplication: {
            pdfDocument: {
              numPages: 1,
              async getData() { return Uint8Array.from(host.readerBytes); },
              async getPageLabels2() { return ["1"]; },
              async getPageData(input) {
                if (input?.[readerRealmRequest] !== true) {
                  const error = new Error("The object could not be cloned.");
                  error.name = "DataCloneError";
                  throw error;
                }
                return structuredClone(pageData);
              },
            },
          },
        },
      },
    },
  };

  const byLibraryKey = (libraryID, key) =>
    [...host.items.values()].find((item) => item.libraryID === libraryID && item.key === key) ?? false;
  const Zotero = {
    version: "10.0.6-fixture",
    Profile: { name: "Native fixture" },
    DB: host.db,
    Libraries: {
      userLibraryID: 1,
      getAll() { return [...host.libraries]; },
      get(libraryID) {
        return host.libraries.find((library) => library.libraryID === libraryID);
      },
    },
    Items: {
      async getAll(libraryID, onlyTopLevel, includeDeleted) {
        const values = [...host.items.values()].filter((item) =>
          item.libraryID === libraryID &&
          (!onlyTopLevel || item.isRegularItem()) &&
          (includeDeleted || item.deleted !== true),
        );
        await host.onItemsGetAll?.(values);
        return values;
      },
      async getByLibraryAndKeyAsync(libraryID, key, options) {
        host.freshReads.push({ kind: "key", libraryID, key, options });
        return byLibraryKey(libraryID, key);
      },
      async getAsync(ids, options) {
        host.freshReads.push({ kind: "id", ids: structuredClone(ids), options });
        if (Array.isArray(ids)) return ids.map((id) => host.items.get(id)).filter(Boolean);
        return host.items.get(ids) ?? false;
      },
      get(id) { return host.items.get(id); },
    },
    Reader: {
      _readers: [reader],
      async open(itemID) {
        if (itemID === reader.itemID) return reader;
        return { ...reader, itemID, close() {} };
      },
    },
    Attachments: {
      LINK_MODE_IMPORTED_FILE: 0,
      getStorageDirectory(item) { return { path: `/storage/${item.key}` }; },
    },
    API: { getLibraryPrefix() { return "library"; } },
    DataObjectUtilities: {
      generateKey() {
        return `ANN${String(host.generatedKeyNumber++).padStart(5, "0")}`;
      },
    },
    Annotations: {
      async saveFromJSON(parent, json) {
        const item = new FakeItem(host, "annotation", {
          key: json.key,
          libraryID: parent.libraryID,
          parentItemID: parent.id,
          annotationType: json.type,
          annotationText: json.text,
          annotationComment: json.comment,
          annotationColor: json.color,
          annotationPageLabel: json.pageLabel,
          annotationSortIndex: json.sortIndex,
          annotationPosition: JSON.stringify(json.position),
        });
        for (const [predicate, values] of Object.entries(json.relations ?? {})) {
          for (const value of Array.isArray(values) ? values : [values]) {
            item.addRelation(predicate, value);
          }
        }
        await item.saveTx();
        reader._internalReader._state.annotations.push({ id: item.key });
        return item;
      },
    },
    Relations: {
      async getByPredicateAndObject(_type, predicate, object) {
        return [...host.items.values()].filter((item) =>
          item.getRelationsByPredicate(predicate).includes(object),
        );
      },
    },
    Item: class extends FakeItem {
      constructor(type) { super(host, type, {}, true); }
    },
  };

  host.reader = reader;
  return {
    host,
    env: {
      Zotero,
      noteContent: new DomPurifyNativeNoteContentPolicy({ window: new JSDOM("").window }),
      IOUtils: {
        async read(path) {
          host.ioReadPaths.push(path);
          const value = host.diskByPath.get(path);
          if (value !== undefined) return Uint8Array.from(value);
          if (path === "/fixture/paper.pdf") return Uint8Array.from(host.diskBytes);
          throw new Error("fixture file missing");
        },
      },
      crypto: webcrypto,
      arxivFileFingerprint: {
        fingerprintNow(path, maximumByteLength) {
          const value = host.diskByPath.get(path) ??
            (path === "/fixture/paper.pdf" ? host.diskBytes : undefined);
          if (value === undefined) return null;
          const bytes = Uint8Array.from(value);
          if (bytes.byteLength > maximumByteLength) {
            throw new Error("fixture PDF exceeds synchronous fingerprint limit");
          }
          return {
            fingerprint: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
            byteLength: bytes.byteLength,
          };
        },
      },
      cloneInto(value, target) {
        if (target === reader._internalReader._primaryView._iframeWindow) {
          return { ...structuredClone(value), [readerRealmRequest]: true };
        }
        if (target === reader._iframeWindow) {
          host.annotationMetaClones += 1;
          return { ...structuredClone(value), [readerRealmPosition]: true };
        }
        assert.fail("native data was cloned into an unrelated realm");
      },
    },
  };
}

const anchor = {
  libraryId: "1",
  itemKey: "ITEM0001",
  attachmentKey: "ATTACH01",
  attachmentFingerprint: "sha256:ignored-by-native-create",
  pageIndex: 0,
  pageLabel: "1",
  rectangles: [{ x1: 10, y1: 20, x2: 17, y2: 30 }],
  selectedText: "A",
  matchEvidence: { method: "exact_quote", matchedText: "A", exact: true },
};

function composedAnnotationHarness() {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const digest = new Sha256Digest();
  const library = new ZoteroLibraryAdapter({
    native,
    noteContent: env.noteContent,
    digest,
    profileId: "profile-A",
    pluginVersion: "fixture",
    enabled: true,
    transport: { kind: "custom", description: "Native fixture" },
  });
  const resolver = new ZoteroAnchorResolver(library);
  const executor = new NativeOperationExecutor({
    reads: library,
    writes: library,
    anchors: resolver,
    storage: library,
    viewer: library,
  });
  const coordinator = new OperationCoordinator({
    store: new MemoryOperationStore(),
    digest,
    serializer: new InlineMutationSerializer(),
  });
  return { coordinator, executor, host, native };
}

function annotationCreateRequest(attachmentFingerprint, comment, operationId) {
  return validateProtocolRequest({
    protocolVersion: 1,
    operationId,
    operation: "create_annotation",
    profileId: "profile-A",
    authorization: { kind: "explicit_request", scope: "Save the exact fixture proof" },
    payload: {
      anchor: { ...anchor, attachmentFingerprint },
      type: "highlight",
      comment,
      color: "#ffd400",
    },
  });
}

function showAnnotationInReader(reader, annotation) {
  reader._internalReader._state.sidebarOpen = true;
  reader._internalReader._state.sidebarView = "annotations";
  reader._internalReader._state.selectedAnnotationIDs = [annotation.annotationKey];
  const rect = { left: 10, right: 300, top: 50, bottom: 120 };
  const content = {
    innerText: annotation.comment,
    isConnected: true,
    getClientRects() { return { length: 1 }; },
    getBoundingClientRect() { return rect; },
  };
  reader._iframeWindow.document = visibleDocument((selector) => {
    if (!selector.includes(annotation.annotationKey)) return null;
    return {
      isConnected: true,
      getClientRects() { return { length: 1 }; },
      getBoundingClientRect() { return rect; },
      querySelector() { return content; },
    };
  });
}

function duplicateReader(reader, tabID) {
  const ownerDocument = visibleDocument();
  const frame = laidOutNode(ownerDocument);
  return {
    itemID: reader.itemID,
    tabID,
    _iframe: frame,
    _tabContainer: laidOutNode(ownerDocument),
    _window: { Zotero_Tabs: { selectedID: tabID } },
    _iframeWindow: { document: visibleDocument(), frameElement: frame },
    _initPromise: Promise.resolve(),
    _internalReader: {
      _state: { annotations: [] },
      _primaryView: reader._internalReader._primaryView,
    },
  };
}

test("native annotation create commits content and durable identity in one Zotero save", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const marker = "urn:zotero-ai-research-companion:operation:owned-fixture:digest";
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");

  const record = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Fixture explanation",
    color: "#ffd400",
    operationMarker: marker,
  });

  assert.equal(record.annotationKey, "ANN00001");
  assert.equal(record.comment, "Fixture explanation");
  assert.deepEqual(record.rectangles, anchor.rectangles);
  assert.deepEqual(record.operationMarkers, [marker]);
  assert.equal(host.savedSnapshots.length, 1);
  assert.deepEqual(host.savedSnapshots[0].relations[OPERATION_RELATION_PREDICATE], [marker]);
  const recovered = await native.findByOperationMarker(marker);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].annotationKey, "ANN00001");
});

test("native annotation create rejects bodies Zotero would normalize before saving", async () => {
  const cases = [
    ["leading-whitespace", " Complete proof"],
    ["trailing-whitespace", "Complete proof\t"],
    ["non-nfc-unicode", "Cafe\u0301 proof"],
  ];
  for (const [description, comment] of cases) {
    const { env, host } = fixtureEnvironment();
    const native = createZoteroNativeApi(env);
    const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");

    await assert.rejects(
      () => native.createAnnotation({
        anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
        type: "highlight",
        comment,
        color: "#ffd400",
        operationMarker: `urn:unrepresentable-create:${description}`,
      }),
      (error) => error instanceof CoreOperationError && error.code === "invalid_request",
      description,
    );
    assert.equal(host.savedSnapshots.length, 0, description);
    assert.equal(
      [...host.items.values()].some((item) => item.isAnnotation()),
      false,
      description,
    );
  }
});

test("native annotation comments preserve meaningful interior whitespace exactly", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const comment = "First proof line\n\n  Indented derivation  \nFinal proof line";

  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment,
    color: "#ffd400",
    operationMarker: "urn:interior-whitespace:create",
  });
  assert.equal(created.comment, comment);

  const replacement = "Replacement line\n\n  Kept indentation  \nLast line";
  const updated = await native.updateAnnotation({
    expected: created,
    comment: replacement,
    operationMarker: "urn:interior-whitespace:update",
  });
  assert.equal(updated.comment, replacement);
  assert.equal(host.savedSnapshots.length, 2);
});

test("coordinator records native comment normalization as a precommit rejection", async () => {
  const { coordinator, executor, host, native } = composedAnnotationHarness();
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const request = annotationCreateRequest(
    attachment.fingerprint,
    "Complete proof\n",
    "op.native-comment-create-rejection",
  );

  const result = await coordinator.submit(
    request,
    "profile-A",
    (accepted, identity) => executor.execute(accepted, identity),
  );

  assert.equal(result.state, "rejected");
  assert.equal(result.error.code, "invalid_request");
  assert.equal(result.error.retryable, false);
  assert.match(result.error.message, /rejected before native mutation/u);
  assert.match(result.error.message, /indeterminate outcome/u);
  assert.deepEqual(result.verification, { storage: "not_checked", viewer: "not_checked" });
  assert.equal(host.savedSnapshots.length, 0);
});

test("native annotation update rejects normalization before changing the target or marker", async () => {
  const cases = [
    ["leading-newline", "\nReplacement proof"],
    ["trailing-newline", "Replacement proof\n"],
    ["non-nfc-unicode", "Re\u0301placement proof"],
  ];
  for (const [description, comment] of cases) {
    const { env, host } = fixtureEnvironment();
    const native = createZoteroNativeApi(env);
    const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
    const created = await native.createAnnotation({
      anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
      type: "highlight",
      comment: "Original proof",
      color: "#ffd400",
      operationMarker: "urn:update-preflight:original",
    });
    const item = [...host.items.values()].find(
      (candidate) => candidate.key === created.annotationKey,
    );

    await assert.rejects(
      () => native.updateAnnotation({
        expected: created,
        comment,
        operationMarker: `urn:update-preflight:${description}`,
      }),
      (error) => error instanceof CoreOperationError && error.code === "invalid_request",
      description,
    );
    assert.equal(item.annotationComment, "Original proof", description);
    assert.deepEqual(
      item.getRelationsByPredicate(OPERATION_RELATION_PREDICATE),
      ["urn:update-preflight:original"],
      description,
    );
    assert.equal(host.savedSnapshots.length, 1, description);
  }
});

test("coordinator rejects an unrepresentable append without a postcommit unknown outcome", async () => {
  const { coordinator, executor, host, native } = composedAnnotationHarness();
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const createRequest = annotationCreateRequest(
    attachment.fingerprint,
    "Original proof",
    "op.native-comment-append-base",
  );
  const created = await coordinator.submit(
    createRequest,
    "profile-A",
    (accepted, identity) => executor.execute(accepted, identity),
  );
  assert.equal(created.state, "succeeded");
  assert.equal(host.savedSnapshots.length, 1);

  const updateRequest = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.native-comment-append-rejection",
    operation: "update_annotation",
    profileId: "profile-A",
    authorization: { kind: "explicit_request", scope: "Append the exact fixture proof" },
    payload: {
      libraryId: "1",
      attachmentKey: "ATTACH01",
      annotationKey: created.data.annotationKey,
      expectedRevision: created.data.revision,
      mode: "append",
      comment: "Added conclusion\n",
    },
  });
  const result = await coordinator.submit(
    updateRequest,
    "profile-A",
    (accepted, identity) => executor.execute(accepted, identity),
  );

  assert.equal(result.state, "rejected");
  assert.equal(result.error.code, "invalid_request");
  assert.equal(result.error.retryable, false);
  assert.deepEqual(result.verification, { storage: "not_checked", viewer: "not_checked" });
  assert.equal(host.savedSnapshots.length, 1);
  const item = [...host.items.values()].find(
    (candidate) => candidate.key === created.data.annotationKey,
  );
  assert.equal(item.annotationComment, "Original proof");
  assert.equal(item.getRelationsByPredicate(OPERATION_RELATION_PREDICATE).length, 1);
});

test("annotation metadata clones native geometry into the outer reader realm", async () => {
  const { env, host } = fixtureEnvironment();
  host.requireClonedAnnotationMeta = true;
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");

  const record = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Reader-realm metadata fixture",
    color: "#ffd400",
    operationMarker: "urn:reader-realm-meta",
  });

  assert.equal(record.annotationKey, "ANN00001");
  assert.equal(host.annotationMetaClones, 1);
});

test("native update re-reads the item and rejects a concurrent manual edit", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Original",
    color: "#ffd400",
    operationMarker: "urn:first",
  });
  const item = [...host.items.values()].find((candidate) => candidate.key === created.annotationKey);
  item.annotationComment = "Manual edit";

  await assert.rejects(
    () => native.updateAnnotation({ expected: created, comment: "Replacement", operationMarker: "urn:second" }),
    (error) => error instanceof CoreOperationError && error.code === "conflict",
  );
  assert.equal(item.annotationComment, "Manual edit");
});

test("page extraction clones its worker request into the native PDF frame realm", async () => {
  const { env } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const page = await native.readPdfPage(attachment, 0);

  assert.equal(attachment.pageCount, 1);
  assert.equal(page.pageLabel, "1");
  assert.deepEqual(page.viewBox, [0, 0, 600, 800]);
  assert.equal(page.chars[0].text, "A");
});

test("page discovery rejects an open reader whose loaded bytes differ from the attachment file", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  host.diskBytes = new Uint8Array([9, 8, 7, 6]);

  await assert.rejects(
    () => native.getPdfAttachment("1", "ATTACH01", "ITEM0001"),
    (error) => error instanceof CoreOperationError && error.code === "stale_attachment",
  );
});

test("page discovery rejects a reader that cannot expose its loaded PDF bytes", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  delete host.reader._internalReader._primaryView._iframeWindow.PDFViewerApplication.pdfDocument.getData;

  await assert.rejects(
    () => native.getPdfAttachment("1", "ATTACH01", "ITEM0001"),
    (error) => error instanceof CoreOperationError && error.code === "stale_attachment",
  );
});

test("a disabled live gate stops a dispatched mutation before native save", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  const native = createZoteroNativeApi({ ...env, accessGate: gate });
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  gate.setEnabled(false);

  await assert.rejects(
    () =>
      native.createAnnotation({
        anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
        type: "highlight",
        comment: "Must not commit",
        color: "#ffd400",
        operationMarker: "urn:disabled",
      }),
    (error) => error instanceof CoreOperationError && error.code === "permission_denied",
  );
  assert.equal(host.savedSnapshots.length, 0);
});

test("disable during annotation refresh leaves the shared cached item unchanged", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  const native = createZoteroNativeApi({ ...env, accessGate: gate });
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Human annotation text",
    color: "#ffd400",
    operationMarker: "urn:annotation-before-disable",
  });
  const item = [...host.items.values()].find(
    (candidate) => candidate.key === created.annotationKey,
  );
  const savedCount = host.savedSnapshots.length;
  host.onLoadAllData = async (candidate) => {
    if (candidate !== item) return;
    host.onLoadAllData = undefined;
    gate.setEnabled(false);
  };

  await assert.rejects(
    () =>
      native.updateAnnotation({
        expected: created,
        comment: "Rejected companion text",
        operationMarker: "urn:annotation-after-disable",
      }),
    (error) => error instanceof CoreOperationError && error.code === "permission_denied",
  );
  assert.equal(item.annotationComment, "Human annotation text");
  assert.deepEqual(
    item.getRelationsByPredicate(OPERATION_RELATION_PREDICATE),
    ["urn:annotation-before-disable"],
  );
  assert.equal(host.savedSnapshots.length, savedCount);
});

test("disable during note refresh leaves the shared cached item unchanged", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  const native = createZoteroNativeApi({ ...env, accessGate: gate });
  const created = await native.createNote({
    libraryId: "1",
    itemKey: "ITEM0001",
    content: "<p>Human note text</p>",
    operationMarker: "urn:note-before-disable",
  });
  const item = [...host.items.values()].find((candidate) => candidate.key === created.noteKey);
  const savedCount = host.savedSnapshots.length;
  host.onLoadAllData = async (candidate) => {
    if (candidate !== item) return;
    host.onLoadAllData = undefined;
    gate.setEnabled(false);
  };

  await assert.rejects(
    () =>
      native.updateNote({
        expected: created,
        content: "<p>Rejected companion note</p>",
        operationMarker: "urn:note-after-disable",
      }),
    (error) => error instanceof CoreOperationError && error.code === "permission_denied",
  );
  assert.equal(item.getNote(), "<p>Human note text</p>");
  assert.deepEqual(
    item.getRelationsByPredicate(OPERATION_RELATION_PREDICATE),
    ["urn:note-before-disable"],
  );
  assert.equal(host.savedSnapshots.length, savedCount);
});

test("annotation model state alone is not reported as rendered viewer evidence", async () => {
  const { env } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Stored but not rendered in the fake DOM",
    color: "#ffd400",
    operationMarker: "urn:model-only",
  });

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
});

test("missing and hidden reader DOM never count as viewer evidence", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "",
    color: "#ffd400",
    operationMarker: "urn:hidden-dom",
  });

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
  host.reader._internalReader._primaryView._iframeWindow.document = {
    querySelector() {
      return {
        isConnected: true,
        getClientRects() { return { length: 0 }; },
      };
    },
  };
  host.reader._iframeWindow = {
    document: {
      querySelector() {
        return {
          isConnected: true,
          getClientRects() { return { length: 0 }; },
        };
      },
    },
  };
  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
});

test("an empty-comment PDF overlay alone is conservatively unconfirmed", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "",
    color: "#ffd400",
    operationMarker: "urn:visible-dom",
  });
  const viewDocument = {
    defaultView: { innerWidth: 800, innerHeight: 600 },
    querySelector() { return null; },
  };
  const renderedRect = {
    isConnected: true,
    getClientRects() { return { length: 1 }; },
    getBoundingClientRect() { return { left: 10, right: 17, top: 20, bottom: 30 }; },
  };
  const overlay = { querySelectorAll() { return [renderedRect]; } };
  const view = host.reader._internalReader._primaryView;
  view._iframeWindow.document = viewDocument;
  view._pages = [{ originalPage: { div: { querySelector() { return overlay; } } } }];

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
});

test("a laid-out annotation sidebar row is not viewer evidence while the sidebar is closed", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Visible only if the annotation sidebar is open",
    color: "#ffd400",
    operationMarker: "urn:closed-sidebar",
  });
  host.reader._internalReader._state.sidebarOpen = false;
  host.reader._internalReader._state.sidebarView = "annotations";
  const rect = { left: 10, right: 300, top: 50, bottom: 100 };
  const content = {
    textContent: created.comment,
    innerText: created.comment,
    isConnected: true,
    getClientRects() { return { length: 1 }; },
    getBoundingClientRect() { return rect; },
  };
  host.reader._iframeWindow.document = visibleDocument((selector) => {
    if (!selector.includes(created.annotationKey)) return null;
    return {
      isConnected: true,
      getClientRects() { return { length: 1 }; },
      getBoundingClientRect() { return rect; },
      querySelector() { return content; },
    };
  });

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
  host.reader._internalReader._state.sidebarOpen = true;
  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), true);
});

test("the visible native editor preserves multiline comment evidence through innerText", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "First proof line\nSecond reference line",
    color: "#ffd400",
    operationMarker: "urn:multiline-viewer-comment",
  });
  host.reader._internalReader._state.sidebarOpen = true;
  host.reader._internalReader._state.sidebarView = "annotations";
  const rect = { left: 10, right: 300, top: 50, bottom: 120 };
  const content = {
    // Browser textContent omits the visual line break inserted by innerText.
    textContent: "First proof lineSecond reference line",
    innerText: created.comment,
    isConnected: true,
    getClientRects() { return { length: 1 }; },
    getBoundingClientRect() { return rect; },
  };
  host.reader._iframeWindow.document = visibleDocument((selector) => {
    if (!selector.includes(created.annotationKey)) return null;
    return {
      isConnected: true,
      getClientRects() { return { length: 1 }; },
      getBoundingClientRect() { return rect; },
      querySelector() { return content; },
    };
  });

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), true);
  content.innerText = "A stale comment still displayed in the editor";
  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
});

test("a hidden owning reader frame or document invalidates visible inner annotation DOM", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Inner row alone cannot prove the owner is visible",
    color: "#ffd400",
    operationMarker: "urn:hidden-reader-owner",
  });
  showAnnotationInReader(host.reader, created);

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), true);
  host.reader._iframe.computedStyle.display = "none";
  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);

  host.reader._iframe.computedStyle.display = "block";
  host.reader._iframeWindow.document.hidden = true;
  host.reader._iframeWindow.document.visibilityState = "hidden";
  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);

  host.reader._iframeWindow.document.hidden = false;
  host.reader._iframeWindow.document.visibilityState = "visible";
  host.reader._tabContainer.computedStyle.display = "none";
  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);

  host.reader._tabContainer.computedStyle.display = "block";
  delete host.reader._iframe;
  delete host.reader._iframeWindow.frameElement;
  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
});

test("a background reader tab is not viewer evidence even with an active document shell", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Background tab fixture",
    color: "#ffd400",
    operationMarker: "urn:background-reader-tab",
  });
  showAnnotationInReader(host.reader, created);
  host.reader._window.Zotero_Tabs.selectedID = "another-tab";
  host.reader._iframe.docShellIsActive = true;

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
});

test("a reader frame owner without computed-style access fails closed", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Unverifiable frame owner fixture",
    color: "#ffd400",
    operationMarker: "urn:frame-owner-without-style-api",
  });
  showAnnotationInReader(host.reader, created);
  delete host.reader._iframe.ownerDocument.defaultView.getComputedStyle;

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
});

test("a tab-container owner without a default view fails closed", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Unverifiable tab owner fixture",
    color: "#ffd400",
    operationMarker: "urn:tab-owner-without-default-view",
  });
  showAnnotationInReader(host.reader, created);
  const tabOwner = visibleDocument();
  delete tabOwner.defaultView;
  host.reader._tabContainer.ownerDocument = tabOwner;

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
});

test("a visible selected duplicate reader can confirm when an earlier duplicate is hidden", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Visible duplicate reader fixture",
    color: "#ffd400",
    operationMarker: "urn:visible-reader-duplicate",
  });
  showAnnotationInReader(host.reader, created);
  host.reader._iframe.computedStyle.display = "none";
  const visible = duplicateReader(host.reader, "reader-tab-2");
  showAnnotationInReader(visible, created);
  env.Zotero.Reader._readers.push(visible);

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), true);
});

test("a visible standalone reader window remains valid without a tab identity", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "Standalone reader window fixture",
    color: "#ffd400",
    operationMarker: "urn:standalone-reader-window",
  });
  showAnnotationInReader(host.reader, created);
  delete host.reader.tabID;
  delete host.reader._window;
  delete host.reader._tabContainer;
  delete host.reader._iframe;

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), true);
});

test("native child-note updates use fresh content and preserve a concurrent manual edit", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const created = await native.createNote({
    libraryId: "1",
    itemKey: "ITEM0001",
    content: "<p>Initial fixture note</p>",
    operationMarker: "urn:note-create",
  });
  assert.deepEqual(created.operationMarkers, ["urn:note-create"]);

  const updated = await native.updateNote({
    expected: created,
    content: "<p>Updated fixture note</p>",
    operationMarker: "urn:note-update",
  });
  assert.match(updated.content, /Updated fixture note/);
  assert.deepEqual(updated.operationMarkers, ["urn:note-create", "urn:note-update"]);

  const item = [...host.items.values()].find((candidate) => candidate.key === created.noteKey);
  item.note = '<div class="zotero-note znv1"><p>Manual edit</p></div>';
  await assert.rejects(
    () =>
      native.updateNote({
        expected: updated,
        content: "<p>Must not replace manual edit</p>",
        operationMarker: "urn:note-stale",
      }),
    (error) => error instanceof CoreOperationError && error.code === "conflict",
  );
  assert.match(item.note, /Manual edit/);
});

test("native child-note writes reject noncanonical active content before save", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const cases = [
    '<p>Native safety words</p><img src="https://example.invalid/native.png" alt="native diagram">',
    '<p><a href="https://references.example/safe" href="javascript:alert(1)">duplicate</a></p>',
    '<p><a href="https://references.example/unterminated>malformed</a></p>',
    '<p><a href="zotero://debug/log">unsupported Zotero action</a></p>',
  ];
  for (const [index, content] of cases.entries()) {
    await assert.rejects(
      () =>
        native.createNote({
          libraryId: "1",
          itemKey: "ITEM0001",
          content,
          operationMarker: `urn:native-unsafe-note-${index}`,
        }),
      (error) => error instanceof CoreOperationError && error.code === "invalid_request",
    );
  }
  assert.equal(
    [...host.items.values()].filter((candidate) => candidate.isNote()).length,
    0,
  );
});

const arxivSource = {
  arxivId: "2401.01234",
  version: 2,
  abstractUrl: "https://arxiv.org/abs/2401.01234v2",
  pdfUrl: "https://arxiv.org/pdf/2401.01234v2",
  metadata: {
    title: "Native arXiv fixture",
    authors: ["Ada Example", "Grace Example"],
    published: "2024-01-03T00:00:00Z",
    updated: "2024-01-04T00:00:00Z",
    abstract: "Native fixture abstract",
    doi: "10.1000/native-fixture",
  },
};

function addFixtureItem(host, itemType, values) {
  const item = new FakeItem(host, itemType, {
    id: host.nextId++,
    ...values,
  });
  host.items.set(item.id, item);
  return item;
}

function addFixtureLibrary(host, libraryID) {
  const library = {
    libraryID,
    clientVersion: 1,
    loadCount: 0,
    async waitForDataLoad(type) {
      assert.equal(type, "item");
      this.loadCount += 1;
    },
  };
  host.libraries.push(library);
  return library;
}

function fixtureFingerprint(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

test("offline arXiv discovery returns complete ordered native evidence without external or write paths", async () => {
  const { env, host } = fixtureEnvironment();
  const requested = { arxivId: "2401.01234", version: 2 };
  const currentBytes = new Uint8Array([37, 80, 68, 70, 45, 70, 73, 78, 68]);
  const currentFingerprint = fixtureFingerprint(currentBytes);
  host.diskByPath.set("/local/current.pdf", currentBytes);

  const parent = addFixtureItem(host, "journalArticle", {
    key: "LOCALP01",
    fields: {
      title: "Local identity evidence",
      date: "2024-02-03",
      url: "https://arxiv.org/abs/2401.01234",
      archiveID: "arXiv:2401.01234v4",
      extra: "arXiv: 2401.01234v3\narXiv: 2401.01234v3",
    },
    creators: [
      { firstName: "Ada", lastName: "Example" },
      { name: "Grace Example" },
    ],
  });
  const parentProvenance = arxivParentProvenance({
    arxivId: requested.arxivId,
    version: 5,
  });
  parent.relations.set(ARXIV_PROVENANCE_RELATION_PREDICATE, [
    parentProvenance,
    parentProvenance,
  ]);

  const currentPdf = addFixtureItem(host, "attachment", {
    key: "AKEYPDF",
    parentItemID: parent.id,
    attachmentContentType: "application/pdf",
    filePath: "/local/current.pdf",
    fields: {
      title: "Current local PDF",
      url: "https://arxiv.org/pdf/2401.05678v1",
    },
  });
  const currentProvenance = arxivAttachmentProvenance(requested, currentFingerprint);
  const staleProvenance = arxivAttachmentProvenance(
    { arxivId: requested.arxivId, version: 9 },
    "sha256:stale-local-pdf",
  );
  currentPdf.relations.set(ARXIV_PROVENANCE_RELATION_PREDICATE, [
    currentProvenance,
    currentProvenance,
    staleProvenance,
  ]);

  addFixtureItem(host, "attachment", {
    key: "FAILPDF",
    parentItemID: parent.id,
    attachmentContentType: "application/pdf",
    filePath: "/missing-local.pdf",
    fields: {
      title: "Missing local PDF",
      url: "https://arxiv.org/pdf/2401.01234v8",
    },
  });
  addFixtureItem(host, "attachment", {
    key: "NOTPDF",
    parentItemID: parent.id,
    attachmentContentType: "text/html",
    fields: {
      title: "Snapshot",
      url: "https://arxiv.org/abs/2401.01234v20",
    },
  });
  addFixtureItem(host, "attachment", {
    key: "DELETEDPDF",
    parentItemID: parent.id,
    attachmentContentType: "application/pdf",
    deleted: true,
    fields: {
      title: "Deleted PDF",
      url: "https://arxiv.org/pdf/2401.01234v21",
    },
  });
  addFixtureItem(host, "journalArticle", {
    key: "TITLEONLY",
    fields: { title: "2401.01234 is only text in this title" },
  });

  let stagingCalls = 0;
  let importFingerprintCalls = 0;
  env.arxivStaging = {
    async installCreateOnly() { stagingCalls += 1; },
  };
  env.arxivFileFingerprint = {
    fingerprintNow() {
      importFingerprintCalls += 1;
      return null;
    },
  };
  const itemCountBefore = host.items.size;
  host.freshReads.length = 0;
  const native = createZoteroNativeApi(env);

  const result = await native.findLocalArxiv(requested, 25);

  assert.equal(result.truncated, false);
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0].paper, {
    libraryId: "1",
    itemKey: "LOCALP01",
    title: "Local identity evidence",
    creators: ["Ada Example", "Grace Example"],
    year: 2024,
    attachments: [
      {
        attachmentKey: "AKEYPDF",
        title: "Current local PDF",
        contentType: "application/pdf",
        fingerprint: currentFingerprint,
      },
      {
        attachmentKey: "FAILPDF",
        title: "Missing local PDF",
        contentType: "application/pdf",
      },
    ],
  });
  assert.deepEqual(result.matches[0].evidence, [
    {
      attachmentKey: null,
      origin: "url",
      arxivId: "2401.01234",
      version: null,
    },
    {
      attachmentKey: null,
      origin: "archive_id",
      arxivId: "2401.01234",
      version: 4,
    },
    {
      attachmentKey: null,
      origin: "extra",
      arxivId: "2401.01234",
      version: 3,
    },
    {
      attachmentKey: null,
      origin: "provenance",
      arxivId: "2401.01234",
      version: 5,
    },
    {
      attachmentKey: "FAILPDF",
      origin: "url",
      arxivId: "2401.01234",
      version: 8,
    },
    {
      attachmentKey: "AKEYPDF",
      origin: "url",
      arxivId: "2401.05678",
      version: 1,
    },
    {
      attachmentKey: "AKEYPDF",
      origin: "provenance",
      arxivId: "2401.01234",
      version: 2,
      fingerprint: currentFingerprint,
    },
  ]);
  assert.equal(
    result.matches[0].evidence.some((entry) => entry.version === 9),
    false,
    "stale provenance must not survive current fingerprint validation",
  );
  assert.equal(result.matches.some((entry) => entry.paper.itemKey === "TITLEONLY"), false);
  assert.equal(host.items.size, itemCountBefore);
  assert.equal(host.transactionStarts, 0);
  assert.equal(host.savedSnapshots.length, 0);
  assert.equal(stagingCalls, 0);
  assert.equal(importFingerprintCalls, 0);
  assert.equal(host.ioReadPaths.some((path) => /^https?:/u.test(path)), false);
  assert.ok(host.freshReads.length > 0);
  assert.equal(
    host.freshReads.every((read) => read.options?.noCache === true),
    true,
    "local discovery must reload parent and child native records without cache",
  );
});

test("offline arXiv discovery never invokes a legacy macOS path-repair getter", async () => {
  const { env, host } = fixtureEnvironment();
  const currentBytes = new Uint8Array([37, 80, 68, 70, 45, 83, 65, 70, 69]);
  const legacyBytes = new Uint8Array([37, 80, 68, 70, 45, 79, 76, 68]);
  const currentFingerprint = fixtureFingerprint(currentBytes);
  const legacyFingerprint = fixtureFingerprint(legacyBytes);
  host.diskByPath.set("/local/current-safe.pdf", currentBytes);
  host.diskByPath.set("/legacy/resolved-by-native.pdf", legacyBytes);

  const parent = addFixtureItem(host, "journalArticle", {
    key: "LEGACYPARENT",
    fields: {
      title: "Legacy path safety",
      archiveID: "arXiv:2401.01234v1",
    },
  });
  addFixtureItem(host, "attachment", {
    key: "CURRENTPDF",
    parentItemID: parent.id,
    attachmentContentType: "application/pdf",
    attachmentPath: "storage:current-safe.pdf",
    filePath: "/local/current-safe.pdf",
    fields: { title: "Ordinary current PDF" },
  });
  const legacyPdf = addFixtureItem(host, "attachment", {
    key: "LEGACYPDF",
    parentItemID: parent.id,
    attachmentContentType: "application/pdf",
    attachmentPath: "AAAAopaque-persistent-descriptor",
    fields: { title: "Legacy persistent-descriptor PDF" },
  });
  legacyPdf.relations.set(ARXIV_PROVENANCE_RELATION_PREDICATE, [
    arxivAttachmentProvenance(
      { arxivId: "2401.01234", version: 2 },
      legacyFingerprint,
    ),
  ]);
  let asyncRepairGetterCalls = 0;
  let syncRepairGetterCalls = 0;
  let nativeWrites = 0;
  legacyPdf.getFilePathAsync = async () => {
    asyncRepairGetterCalls += 1;
    nativeWrites += 1;
    return "/legacy/resolved-by-native.pdf";
  };
  legacyPdf.getFilePath = () => {
    syncRepairGetterCalls += 1;
    nativeWrites += 1;
    return "/legacy/resolved-by-native.pdf";
  };
  const native = createZoteroNativeApi(env);

  const result = await native.findLocalArxiv({ arxivId: "2401.01234" }, 25);

  assert.deepEqual(result.matches[0].paper.attachments, [
    {
      attachmentKey: "CURRENTPDF",
      title: "Ordinary current PDF",
      contentType: "application/pdf",
      fingerprint: currentFingerprint,
    },
    {
      attachmentKey: "LEGACYPDF",
      title: "Legacy persistent-descriptor PDF",
      contentType: "application/pdf",
    },
  ]);
  assert.deepEqual(result.matches[0].evidence, [
    {
      attachmentKey: null,
      origin: "archive_id",
      arxivId: "2401.01234",
      version: 1,
    },
  ]);
  assert.equal(asyncRepairGetterCalls, 0);
  assert.equal(syncRepairGetterCalls, 0);
  assert.equal(nativeWrites, 0);
  assert.equal(host.transactionStarts, 0);
  assert.deepEqual(host.ioReadPaths, ["/local/current-safe.pdf"]);
});

test("offline arXiv discovery searches every eligible library and deduplicates native parents", async () => {
  const { env, host } = fixtureEnvironment();
  const requested = { arxivId: "2401.01234" };
  const library10 = addFixtureLibrary(host, 10);
  const library2 = addFixtureLibrary(host, 2);
  host.libraries.push(library2);

  const attachmentOnly = addFixtureItem(host, "journalArticle", {
    libraryID: 1,
    key: "ATTACHONLY",
    fields: { title: "Attachment-only identity" },
  });
  addFixtureItem(host, "attachment", {
    libraryID: 1,
    key: "ONLYPDF",
    parentItemID: attachmentOnly.id,
    attachmentContentType: "application/pdf",
    fields: {
      title: "Identity-bearing PDF",
      url: "https://arxiv.org/pdf/2401.01234v2",
    },
  });
  addFixtureItem(host, "journalArticle", {
    libraryID: 10,
    key: "METADATA10",
    fields: {
      title: "Metadata-only library ten",
      archiveID: "arXiv:2401.01234v3",
    },
  });
  addFixtureItem(host, "journalArticle", {
    libraryID: 2,
    key: "METADATA02",
    fields: {
      title: "Metadata-only library two",
      extra: "arXiv:2401.01234v4",
    },
  });
  addFixtureItem(host, "journalArticle", {
    libraryID: 1,
    key: "DELETEDPARENT",
    deleted: true,
    fields: {
      title: "Deleted matching parent",
      archiveID: "arXiv:2401.01234v5",
    },
  });
  const deletedChildParent = addFixtureItem(host, "journalArticle", {
    libraryID: 1,
    key: "DELETEDCHILD",
    fields: { title: "Only a deleted child matches" },
  });
  addFixtureItem(host, "attachment", {
    libraryID: 1,
    key: "TRASHEDPDF",
    parentItemID: deletedChildParent.id,
    attachmentContentType: "application/pdf",
    deleted: true,
    fields: { url: "https://arxiv.org/pdf/2401.01234v6" },
  });
  addFixtureItem(host, "attachment", {
    libraryID: 1,
    key: "STANDALONE",
    attachmentContentType: "application/pdf",
    fields: { url: "https://arxiv.org/pdf/2401.01234v7" },
  });

  const originalGetAll = env.Zotero.Items.getAll.bind(env.Zotero.Items);
  env.Zotero.Items.getAll = async (...args) => {
    const items = await originalGetAll(...args);
    return [...items, ...items];
  };
  const native = createZoteroNativeApi(env);

  const result = await native.findLocalArxiv(requested, 25);

  assert.deepEqual(
    result.matches.map((entry) => `${entry.paper.libraryId}/${entry.paper.itemKey}`),
    ["1/ATTACHONLY", "10/METADATA10", "2/METADATA02"],
  );
  assert.deepEqual(result.matches[0].evidence, [
    {
      attachmentKey: "ONLYPDF",
      origin: "url",
      arxivId: "2401.01234",
      version: 2,
    },
  ]);
  assert.deepEqual(result.matches[1].paper.attachments, []);
  assert.deepEqual(result.matches[2].paper.attachments, []);
  assert.equal(result.truncated, false);
  assert.equal(library10.loadCount, 1);
  assert.equal(library2.loadCount, 1);
});

test("offline arXiv discovery uses limit plus one truncation in stable native-key order", async () => {
  const { env, host } = fixtureEnvironment();
  for (const key of ["LOCALC", "LOCALA", "LOCALB"]) {
    addFixtureItem(host, "journalArticle", {
      key,
      fields: {
        title: key,
        archiveID: "arXiv:2401.01234v1",
      },
    });
  }
  const native = createZoteroNativeApi(env);

  const limited = await native.findLocalArxiv({ arxivId: "2401.01234" }, 2);
  assert.deepEqual(
    limited.matches.map((entry) => entry.paper.itemKey),
    ["LOCALA", "LOCALB"],
  );
  assert.equal(limited.truncated, true);

  const complete = await native.findLocalArxiv({ arxivId: "2401.01234" }, 3);
  assert.deepEqual(
    complete.matches.map((entry) => entry.paper.itemKey),
    ["LOCALA", "LOCALB", "LOCALC"],
  );
  assert.equal(complete.truncated, false);
});

test("offline arXiv discovery rejects a qualifying candidate with more than 100 evidence records", async () => {
  const { env, host } = fixtureEnvironment();
  addFixtureItem(host, "journalArticle", {
    key: "TOOMANY1",
    fields: {
      title: "Too much local identity evidence",
      extra: Array.from(
        { length: 101 },
        (_, index) => `arXiv:2401.01234v${String(index + 1)}`,
      ).join("\n"),
    },
  });
  const native = createZoteroNativeApi(env);

  await assert.rejects(
    native.findLocalArxiv({ arxivId: "2401.01234" }, 25),
    (error) =>
      error instanceof CoreOperationError &&
      error.code === "too_large" &&
      /more than 100 local arXiv evidence records/iu.test(error.message),
  );
  assert.equal(host.transactionStarts, 0);
  assert.equal(host.savedSnapshots.length, 0);
});

function arxivImporter(native, inspection, bytes) {
  const fingerprint = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const snapshot = JSON.stringify({ source: arxivSource, ...inspection });
  return {
    fingerprint,
    adapter: new ZoteroArxivNativeImport({
      native,
      acquisition: {
        async acquire(requested) {
          return {
            source: structuredClone(requested),
            contentType: "application/pdf",
            body: Uint8Array.from(bytes),
            fingerprint,
            byteLength: bytes.byteLength,
            pageCount: 1,
          };
        },
      },
      staging: {
        async stage(pdf) {
          return {
            stagingId: "owned-postcommit-stage",
            source: structuredClone(pdf.source),
            fingerprint: pdf.fingerprint,
            byteLength: pdf.byteLength,
            pageCount: pdf.pageCount,
          };
        },
        async discard() {},
      },
      tokens: {
        async matches(token, current) {
          return token === "postcommit-token" && JSON.stringify(current) === snapshot;
        },
      },
      operations: { async checkpointNativeEvidence() { return {}; } },
    }),
  };
}

test("actual native importer keeps postcommit access loss uncertain for new and reused parents", async () => {
  const stagedBytes = new Uint8Array([37, 80, 68, 70, 45, 91, 92, 93]);
  for (const selectionKind of ["create", "attach"]) {
    const { env, host } = fixtureEnvironment();
    const gate = new MutableZoteroAccessGate(true);
    env.accessGate = gate;
    let existingParent;
    if (selectionKind === "attach") {
      existingParent = new FakeItem(host, "journalArticle", {
        id: host.nextId++,
        key: "POSTCOMMITPARENT",
        fields: {
          title: "Existing canonical parent",
          extra: "arXiv:2401.01234v2",
        },
      });
      host.items.set(existingParent.id, existingParent);
    }
    const native = createZoteroNativeApi(env);
    const inspection = await native.inspectArxiv(arxivSource);
    const { adapter } = arxivImporter(native, inspection, stagedBytes);
    const selection = selectionKind === "create"
      ? { kind: "create" }
      : {
          kind: "attach",
          itemKey: existingParent.key,
          expectedItemRevision: inspection.candidates[0].itemRevision,
        };
    host.afterTransactionCommit = async () => {
      host.afterTransactionCommit = undefined;
      gate.setEnabled(false);
    };

    const outcome = await adapter.ensure({
      source: arxivSource,
      selection,
      inspectionToken: "postcommit-token",
      accessFence: adapter.captureAccessFence(),
      identity: {
        operationId: `postcommit-${selectionKind}`,
        requestDigest: `digest-postcommit-${selectionKind}`,
      },
    });

    assert.equal(outcome.kind, "indeterminate");
    assert.equal(outcome.error.code, "unknown_outcome");
    if (selectionKind === "create") {
      assert.equal(
        [...host.items.values()].filter((item) =>
          item.isRegularItem() && item.key !== "ITEM0001"
        ).length,
        1,
      );
    } else {
      assert.equal(existingParent.getAttachments().length, 1);
    }
  }
});

test("actual native importer keeps post-file-create access loss uncertain", async () => {
  const stagedBytes = new Uint8Array([37, 80, 68, 70, 45, 101, 102, 103]);
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  env.accessGate = gate;
  let fileCreates = 0;
  env.arxivStaging = {
    async installCreateOnly(_stagingId, destination, fileName, commitValidatedCreate) {
      await commitValidatedCreate(() => {
        fileCreates += 1;
        host.diskByPath.set(
          `${destination}/${fileName}`,
          Uint8Array.from(stagedBytes),
        );
        host.readerBytes = Uint8Array.from(stagedBytes);
        gate.setEnabled(false);
      });
    },
  };
  const native = createZoteroNativeApi(env);
  const inspection = await native.inspectArxiv(arxivSource);
  const { adapter } = arxivImporter(native, inspection, stagedBytes);

  const outcome = await adapter.ensure({
    source: arxivSource,
    selection: { kind: "create" },
    inspectionToken: "postcommit-token",
    accessFence: adapter.captureAccessFence(),
    identity: {
      operationId: "post-file-create",
      requestDigest: "digest-post-file-create",
    },
  });

  assert.equal(outcome.kind, "indeterminate");
  assert.equal(outcome.error.code, "unknown_outcome");
  assert.equal(fileCreates, 1);
  assert.equal(
    [...host.diskByPath.keys()].filter((path) => path.endsWith("arxiv-2401.01234-v2.pdf")).length,
    1,
  );
});

test("actual native importer rolls back an attachment when PDF bytes change during save", async () => {
  const canonicalBytes = new Uint8Array([37, 80, 68, 70, 45, 121, 122, 123]);
  const originalBytes = new Uint8Array([37, 80, 68, 70, 45, 31, 32, 33]);
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  env.accessGate = gate;
  const parent = new FakeItem(host, "journalArticle", {
    key: "SAVEAWAITPARENT",
    fields: {
      title: "Canonical parent with an older PDF",
      extra: "arXiv:2401.01234v2",
    },
  });
  await parent.saveTx();
  const existingPath = "/race/save-await-existing.pdf";
  host.diskByPath.set(existingPath, Uint8Array.from(originalBytes));
  const existingPdf = new FakeItem(host, "attachment", {
    key: "SAVEAWAITOLD",
    parentItemID: parent.id,
    attachmentContentType: "application/pdf",
    filePath: existingPath,
    fields: {
      title: "Older-version manual PDF",
      url: "https://arxiv.org/pdf/2401.01234v1",
    },
  });
  await existingPdf.saveTx();
  const native = createZoteroNativeApi(env);
  const inspection = await native.inspectArxiv(arxivSource);
  const { adapter } = arxivImporter(native, inspection, canonicalBytes);
  host.onItemSave = async (item) => {
    if (!item.isPDFAttachment() || item.key === existingPdf.key) return;
    host.onItemSave = undefined;
    await Promise.resolve();
    host.diskByPath.set(existingPath, Uint8Array.from(canonicalBytes));
  };

  const outcome = await adapter.ensure({
    source: arxivSource,
    selection: {
      kind: "attach",
      itemKey: parent.key,
      expectedItemRevision: inspection.candidates[0].itemRevision,
    },
    inspectionToken: "postcommit-token",
    accessFence: adapter.captureAccessFence(),
    identity: {
      operationId: "attachment-save-byte-race",
      requestDigest: "digest-attachment-save-byte-race",
    },
  });

  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error.code, "conflict");
  assert.deepEqual(host.diskByPath.get(existingPath), canonicalBytes);
  assert.deepEqual(parent.getAttachments(), [existingPdf.id]);
});

test("native arXiv inspection finds every canonical manual parent and keeps missing PDFs conservative", async () => {
  const { env, host } = fixtureEnvironment();
  const manual = new FakeItem(host, "journalArticle", {
    id: host.nextId++,
    key: "MANUAL01",
    fields: {
      title: "Human-authored title",
      extra: "arXiv:2401.01234\nversion: 2",
      url: "",
    },
  });
  const exactPdf = new FakeItem(host, "attachment", {
    id: host.nextId++,
    key: "MANPDF01",
    parentItemID: manual.id,
    attachmentContentType: "application/pdf",
    fields: { title: "Manual PDF", url: "https://arxiv.org/pdf/2401.01234v2" },
  });
  const provenPdf = new FakeItem(host, "attachment", {
    id: host.nextId++,
    key: "PROVEN01",
    parentItemID: manual.id,
    attachmentContentType: "application/pdf",
    fields: { title: "Provenance PDF", url: "https://arxiv.org/pdf/2401.01234v2" },
  });
  const provenDigest = await webcrypto.subtle.digest("SHA-256", host.diskBytes);
  const provenFingerprint = `sha256:${[...new Uint8Array(provenDigest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
  provenPdf.addRelation(
    ARXIV_PROVENANCE_RELATION_PREDICATE,
    arxivAttachmentProvenance(arxivSource, provenFingerprint),
  );
  const missingPdf = new FakeItem(host, "attachment", {
    id: host.nextId++,
    key: "MISSING1",
    parentItemID: manual.id,
    attachmentContentType: "application/pdf",
    filePath: false,
    fields: { title: "Missing PDF", url: "https://arxiv.org/pdf/2401.01234v2" },
  });
  const relationOnly = new FakeItem(host, "journalArticle", {
    id: host.nextId++,
    key: "RELATION1",
    fields: {
      title: "Relation-recognized import",
      url: "https://arxiv.org/abs/9999.99999v1",
    },
  });
  relationOnly.addRelation(
    ARXIV_PROVENANCE_RELATION_PREDICATE,
    arxivParentProvenance(arxivSource),
  );
  const titleOnly = new FakeItem(host, "journalArticle", {
    id: host.nextId++,
    key: "TITLEONLY",
    fields: { title: arxivSource.metadata.title },
  });
  const conflictingExtra = new FakeItem(host, "journalArticle", {
    id: host.nextId++,
    key: "CONFLICTX",
    fields: {
      title: "Repeated conflicting Extra identities",
      extra: "arXiv:2401.01234v2\narXiv:2401.05678v2\narXiv:2401.01234v2",
    },
  });
  const attachmentOnly = new FakeItem(host, "journalArticle", {
    id: host.nextId++,
    key: "CHILDURL1",
    fields: { title: "Recognized from its manual attachment URL" },
  });
  const attachmentOnlyPdf = new FakeItem(host, "attachment", {
    id: host.nextId++,
    key: "CHILDPDF",
    parentItemID: attachmentOnly.id,
    attachmentContentType: "application/pdf",
    fields: { title: "Manual URL PDF", url: "https://arxiv.org/pdf/2401.01234v2" },
  });
  for (const item of [
    manual,
    exactPdf,
    provenPdf,
    missingPdf,
    relationOnly,
    titleOnly,
    conflictingExtra,
    attachmentOnly,
    attachmentOnlyPdf,
  ]) {
    host.items.set(item.id, item);
  }
  const native = createZoteroNativeApi(env);

  const inspection = await native.inspectArxiv(arxivSource);

  assert.deepEqual(inspection.candidates.map((candidate) => candidate.itemKey), [
    "CHILDURL1",
    "CONFLICTX",
    "MANUAL01",
    "RELATION1",
  ]);
  const candidate = inspection.candidates.find((entry) => entry.itemKey === "MANUAL01");
  assert.equal(candidate.title, "Human-authored title");
  assert.equal(candidate.attachments.length, 3);
  assert.equal(candidate.attachments.find((entry) => entry.attachmentKey === "MANPDF01").identity, "unverified");
  assert.equal(candidate.attachments.find((entry) => entry.attachmentKey === "MANPDF01").version, 2);
  assert.equal(candidate.attachments.find((entry) => entry.attachmentKey === "PROVEN01").identity, "verified");
  assert.equal(candidate.attachments.find((entry) => entry.attachmentKey === "MISSING1").fingerprint, null);
  assert.equal(candidate.attachments.find((entry) => entry.attachmentKey === "MISSING1").identity, "unverified");
  const childUrlCandidate = inspection.candidates.find((entry) => entry.itemKey === "CHILDURL1");
  assert.equal(childUrlCandidate.attachments[0].identity, "unverified");
  assert.equal(childUrlCandidate.attachments[0].version, 2);
  assert.equal(inspection.candidates.some((entry) => entry.itemKey === "TITLEONLY"), false);
});

test("native arXiv parent commit rejects a library change during its awaited snapshot", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  env.accessGate = gate;
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const before = await native.inspectArxiv(arxivSource);
  assert.deepEqual(before.candidates, []);
  const plan = await native.planArxivImportKeys(true);
  host.onItemsGetAll = async () => {
    host.onItemsGetAll = undefined;
    const concurrent = new FakeItem(host, "journalArticle", {
      key: "PARENTRACE",
      fields: {
        title: "Concurrent canonical parent",
        extra: "arXiv:2401.01234v2",
      },
    });
    await concurrent.save();
  };

  await assert.rejects(
    native.createArxivParent({
      source: arxivSource,
      itemKey: plan.itemKey,
      operationMarker: "urn:zotero-ai-research-companion:operation:parent-race",
      parentProvenance: arxivParentProvenance(arxivSource),
      expectedCandidates: before.candidates,
      accessFence: fence,
    }),
    /library changed during native arXiv commit preparation/i,
  );
  assert.equal([...host.items.values()].some((item) => item.key === plan.itemKey), false);
  assert.equal([...host.items.values()].some((item) => item.key === "PARENTRACE"), true);
});

test("native arXiv parent initialization preserves an item resolved at the planned key", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  env.accessGate = gate;
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const before = await native.inspectArxiv(arxivSource);
  const plan = await native.planArxivImportKeys(true);
  let resolvedItem;
  host.onLoadPrimaryData = async (item) => {
    host.onLoadPrimaryData = undefined;
    item.id = 900;
    item.fields = { title: "Existing manual item" };
    item.creators = [{ name: "Manual Author", creatorType: "author" }];
    resolvedItem = item;
  };

  await assert.rejects(
    native.createArxivParent({
      source: arxivSource,
      itemKey: plan.itemKey,
      operationMarker: "urn:zotero-ai-research-companion:operation:resolved-parent-key",
      parentProvenance: arxivParentProvenance(arxivSource),
      expectedCandidates: before.candidates,
      accessFence: fence,
    }),
    (error) =>
      error instanceof CoreOperationError &&
      error.code === "conflict" &&
      /parent key became occupied during native initialization/i.test(error.message),
  );
  assert.deepEqual(resolvedItem.fields, { title: "Existing manual item" });
  assert.deepEqual(resolvedItem.creators, [
    { name: "Manual Author", creatorType: "author" },
  ]);
  assert.equal([...host.items.values()].some((item) => item.key === plan.itemKey), false);
});

test("native arXiv parent initialization rechecks authority and library revision after key loading", async (t) => {
  for (const scenario of [
    {
      name: "access cancellation",
      expectedCode: "permission_denied",
      mutate({ gate }) { gate.setEnabled(false); },
    },
    {
      name: "library revision change",
      expectedCode: "conflict",
      mutate({ host }) { host.bumpClientVersion(); },
    },
  ]) {
    await t.test(scenario.name, async () => {
      const { env, host } = fixtureEnvironment();
      const gate = new MutableZoteroAccessGate(true);
      env.accessGate = gate;
      const native = createZoteroNativeApi(env);
      const fence = native.captureArxivAccessFence();
      const before = await native.inspectArxiv(arxivSource);
      const plan = await native.planArxivImportKeys(true);
      let prospectiveItem;
      host.onLoadPrimaryData = async (item) => {
        host.onLoadPrimaryData = undefined;
        prospectiveItem = item;
        scenario.mutate({ gate, host });
      };

      await assert.rejects(
        native.createArxivParent({
          source: arxivSource,
          itemKey: plan.itemKey,
          operationMarker: `urn:zotero-ai-research-companion:operation:${scenario.name.replaceAll(" ", "-")}`,
          parentProvenance: arxivParentProvenance(arxivSource),
          expectedCandidates: before.candidates,
          accessFence: fence,
        }),
        (error) =>
          error instanceof CoreOperationError && error.code === scenario.expectedCode,
      );
      assert.equal(prospectiveItem.fields, undefined);
      assert.equal([...host.items.values()].some((item) => item.key === plan.itemKey), false);
    });
  }
});

test("native arXiv parent initialization rechecks relevant PDF bytes after key loading", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  env.accessGate = gate;
  const parent = new FakeItem(host, "journalArticle", {
    key: "LOADBYTEPARENT",
    fields: {
      title: "Canonical parent with an existing PDF",
      extra: "arXiv:2401.01234v1",
    },
  });
  await parent.saveTx();
  const existingPath = "/race/load-primary-existing.pdf";
  const originalBytes = new Uint8Array([37, 80, 68, 70, 45, 41, 42, 43]);
  const replacementBytes = new Uint8Array([37, 80, 68, 70, 45, 51, 52, 53]);
  host.diskByPath.set(existingPath, originalBytes);
  const existingPdf = new FakeItem(host, "attachment", {
    key: "LOADBYTEPDF",
    parentItemID: parent.id,
    attachmentContentType: "application/pdf",
    filePath: existingPath,
    fields: {
      title: "Existing version PDF",
      url: "https://arxiv.org/pdf/2401.01234v1",
    },
  });
  await existingPdf.saveTx();
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const before = await native.inspectArxiv(arxivSource);
  const plan = await native.planArxivImportKeys(true);
  let prospectiveItem;
  host.onLoadPrimaryData = async (item) => {
    host.onLoadPrimaryData = undefined;
    prospectiveItem = item;
    host.diskByPath.set(existingPath, replacementBytes);
  };

  await assert.rejects(
    native.createArxivParent({
      source: arxivSource,
      itemKey: plan.itemKey,
      operationMarker: "urn:zotero-ai-research-companion:operation:load-primary-byte-change",
      parentProvenance: arxivParentProvenance(arxivSource),
      expectedCandidates: before.candidates,
      accessFence: fence,
    }),
    (error) =>
      error instanceof CoreOperationError &&
      error.code === "conflict" &&
      /PDF bytes changed during native arXiv preparation/i.test(error.message),
  );
  assert.equal(prospectiveItem.fields, undefined);
  assert.deepEqual(host.diskByPath.get(existingPath), replacementBytes);
  assert.equal([...host.items.values()].some((item) => item.key === plan.itemKey), false);
});

test("native arXiv attachment initialization preserves an item resolved at the planned key", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  env.accessGate = gate;
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const empty = await native.inspectArxiv(arxivSource);
  const plan = await native.planArxivImportKeys(true);
  await native.createArxivParent({
    source: arxivSource,
    itemKey: plan.itemKey,
    operationMarker: "urn:zotero-ai-research-companion:operation:resolved-attachment-parent",
    parentProvenance: arxivParentProvenance(arxivSource),
    expectedCandidates: empty.candidates,
    accessFence: fence,
  });
  const beforeAttachment = await native.inspectArxiv(arxivSource);
  let resolvedAttachment;
  host.onLoadPrimaryData = async (item) => {
    host.onLoadPrimaryData = undefined;
    item.id = 901;
    item.fields = { title: "Existing manual attachment" };
    item.attachmentContentType = "application/octet-stream";
    resolvedAttachment = item;
  };

  await assert.rejects(
    native.createArxivAttachment({
      source: arxivSource,
      itemKey: plan.itemKey,
      attachmentKey: plan.attachmentKey,
      operationMarker: "urn:zotero-ai-research-companion:operation:resolved-attachment-key",
      attachmentProvenance: arxivAttachmentProvenance(
        arxivSource,
        "sha256:resolved-attachment-key",
      ),
      expectedCandidates: beforeAttachment.candidates,
      accessFence: fence,
    }),
    (error) =>
      error instanceof CoreOperationError &&
      error.code === "conflict" &&
      /attachment key became occupied during native initialization/i.test(error.message),
  );
  assert.deepEqual(resolvedAttachment.fields, { title: "Existing manual attachment" });
  assert.equal(resolvedAttachment.attachmentContentType, "application/octet-stream");
  assert.equal([...host.items.values()].some((item) => item.key === plan.attachmentKey), false);
});

test("native arXiv attachment commit rejects a digest-time manual edit without losing it", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  let duringDigest;
  env.crypto = {
    subtle: {
      async digest(algorithm, data) {
        await duringDigest?.(data);
        return webcrypto.subtle.digest(algorithm, data);
      },
    },
  };
  env.accessGate = gate;
  const parent = new FakeItem(host, "journalArticle", {
    key: "ATTACHRACE",
    fields: {
      title: "Original manual title",
      extra: "arXiv:2401.01234v2",
    },
  });
  await parent.saveTx();
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const before = await native.inspectArxiv(arxivSource);
  const plan = await native.planArxivImportKeys(false);
  duringDigest = async (data) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const material = new TextDecoder().decode(bytes);
    if (!material.includes('"itemKey":"ATTACHRACE"')) return;
    duringDigest = undefined;
    parent.setField("title", "Concurrent manual title");
    await parent.save();
  };

  await assert.rejects(
    native.createArxivAttachment({
      source: arxivSource,
      itemKey: parent.key,
      attachmentKey: plan.attachmentKey,
      operationMarker: "urn:zotero-ai-research-companion:operation:attachment-race",
      attachmentProvenance: arxivAttachmentProvenance(
        arxivSource,
        "sha256:attachment-race",
      ),
      expectedCandidates: before.candidates,
      accessFence: fence,
    }),
    /library changed during native arXiv commit preparation/i,
  );
  assert.equal(parent.getField("title"), "Concurrent manual title");
  assert.equal([...host.items.values()].some((item) => item.key === plan.attachmentKey), false);
});

test("native arXiv attachment commit rejects a digest-time PDF byte replacement", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  let duringDigest;
  env.crypto = {
    subtle: {
      async digest(algorithm, data) {
        await duringDigest?.(data);
        return webcrypto.subtle.digest(algorithm, data);
      },
    },
  };
  env.accessGate = gate;
  const parent = new FakeItem(host, "journalArticle", {
    key: "ATTACHBYTERACE",
    fields: {
      title: "Canonical parent with an older PDF",
      extra: "arXiv:2401.01234v2",
    },
  });
  await parent.saveTx();
  const oldPath = "/race/attachment-boundary.pdf";
  const oldBytes = new Uint8Array([37, 80, 68, 70, 45, 11, 12, 13]);
  const replacementBytes = new Uint8Array([37, 80, 68, 70, 45, 21, 22, 23]);
  host.diskByPath.set(oldPath, oldBytes);
  const oldPdf = new FakeItem(host, "attachment", {
    key: "ATTACHBYTEOLD",
    parentItemID: parent.id,
    attachmentContentType: "application/pdf",
    filePath: oldPath,
    fields: {
      title: "Older-version PDF",
      url: "https://arxiv.org/pdf/2401.01234v1",
    },
  });
  await oldPdf.saveTx();
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const before = await native.inspectArxiv(arxivSource);
  const plan = await native.planArxivImportKeys(false);
  const revisionBefore = host.clientVersion;
  duringDigest = async (data) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const material = new TextDecoder().decode(bytes);
    if (!material.includes('"itemKey":"ATTACHBYTERACE"')) return;
    duringDigest = undefined;
    host.diskByPath.set(oldPath, Uint8Array.from(replacementBytes));
  };

  await assert.rejects(
    native.createArxivAttachment({
      source: arxivSource,
      itemKey: parent.key,
      attachmentKey: plan.attachmentKey,
      operationMarker: "urn:zotero-ai-research-companion:operation:attachment-byte-race",
      attachmentProvenance: arxivAttachmentProvenance(
        arxivSource,
        `sha256:${createHash("sha256").update(replacementBytes).digest("hex")}`,
      ),
      expectedCandidates: before.candidates,
      accessFence: fence,
    }),
    /PDF bytes changed during native arXiv preparation/i,
  );
  assert.equal(host.clientVersion, revisionBefore);
  assert.deepEqual(host.diskByPath.get(oldPath), replacementBytes);
  assert.equal([...host.items.values()].some((item) => item.key === plan.attachmentKey), false);
});

test("native arXiv commit rechecks disablement after waiting for the transaction", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  env.accessGate = gate;
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const before = await native.inspectArxiv(arxivSource);
  const plan = await native.planArxivImportKeys(true);
  let releaseBlocker;
  let blockerStarted;
  const blockerReady = new Promise((resolve) => { blockerStarted = resolve; });
  const blocker = host.db.executeTransaction(async () => {
    blockerStarted();
    await new Promise((resolve) => { releaseBlocker = resolve; });
  });
  await blockerReady;
  const pending = native.createArxivParent({
    source: arxivSource,
    itemKey: plan.itemKey,
    operationMarker: "urn:zotero-ai-research-companion:operation:disabled-waiter",
    parentProvenance: arxivParentProvenance(arxivSource),
    expectedCandidates: before.candidates,
    accessFence: fence,
  });
  while (host.transactionWaiters === 0) await new Promise((resolve) => setImmediate(resolve));
  gate.setEnabled(false);
  releaseBlocker();
  await blocker;

  await assert.rejects(
    pending,
    (error) =>
      error instanceof CoreOperationError &&
      error.code === "permission_denied" &&
      /access changed before native arXiv commit/i.test(error.message),
  );
  assert.equal([...host.items.values()].some((item) => item.key === plan.itemKey), false);
});

test("native arXiv file commit rejects digest-time byte replacement without a library revision", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  const stagedBytes = new Uint8Array([37, 80, 68, 70, 45, 61, 62, 63]);
  const fingerprint = `sha256:${createHash("sha256").update(stagedBytes).digest("hex")}`;
  let duringDigest;
  let fileCreates = 0;
  env.crypto = {
    subtle: {
      async digest(algorithm, data) {
        await duringDigest?.(data);
        return webcrypto.subtle.digest(algorithm, data);
      },
    },
  };
  env.accessGate = gate;
  env.arxivStaging = {
    async installCreateOnly(_stagingId, destination, fileName, commitValidatedCreate) {
      duringDigest = async (data) => {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const material = new TextDecoder().decode(bytes);
        if (!material.includes('"itemKey":"BYTERACEPARENT"')) return;
        duringDigest = undefined;
        host.diskByPath.set("/race/replaced.pdf", Uint8Array.from(stagedBytes));
      };
      await commitValidatedCreate(() => {
        fileCreates += 1;
        const path = `${destination}/${fileName}`;
        assert.equal(host.diskByPath.has(path), false);
        host.diskByPath.set(path, Uint8Array.from(stagedBytes));
        host.readerBytes = Uint8Array.from(stagedBytes);
      });
    },
  };
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const empty = await native.inspectArxiv(arxivSource);
  const keys = await native.planArxivImportKeys(true);
  await native.createArxivParent({
    source: arxivSource,
    itemKey: "BYTERACEPARENT",
    operationMarker: "urn:zotero-ai-research-companion:operation:byte-race-parent",
    parentProvenance: arxivParentProvenance(arxivSource),
    expectedCandidates: empty.candidates,
    accessFence: fence,
  });
  const parent = [...host.items.values()].find((item) => item.key === "BYTERACEPARENT");
  const priorBytes = new Uint8Array([37, 80, 68, 70, 45, 1, 1, 1]);
  host.diskByPath.set("/race/replaced.pdf", priorBytes);
  const priorPdf = new FakeItem(host, "attachment", {
    key: "BYTERACEOLD",
    parentItemID: parent.id,
    attachmentContentType: "application/pdf",
    filePath: "/race/replaced.pdf",
    fields: {
      title: "Different-version manual PDF",
      url: "https://arxiv.org/pdf/2401.01234v1",
    },
  });
  await priorPdf.saveTx();
  const beforeAttachment = await native.inspectArxiv(arxivSource);
  await native.createArxivAttachment({
    source: arxivSource,
    itemKey: parent.key,
    attachmentKey: keys.attachmentKey,
    operationMarker: "urn:zotero-ai-research-companion:operation:byte-race-attachment",
    attachmentProvenance: arxivAttachmentProvenance(arxivSource, fingerprint),
    expectedCandidates: beforeAttachment.candidates,
    accessFence: fence,
  });
  const beforeInstall = await native.inspectArxiv(arxivSource);
  const revisionBeforeInstall = host.clientVersion;

  await assert.rejects(
    native.installArxivPdf({
      source: arxivSource,
      itemKey: parent.key,
      attachmentKey: keys.attachmentKey,
      stagedPdf: {
        stagingId: "owned-byte-race-stage",
        source: { arxivId: arxivSource.arxivId, version: arxivSource.version },
        fingerprint,
        byteLength: stagedBytes.byteLength,
        pageCount: 1,
      },
      expectedCandidates: beforeInstall.candidates,
      accessFence: fence,
    }),
    /PDF bytes changed during native arXiv preparation/i,
  );
  assert.equal(host.clientVersion, revisionBeforeInstall);
  assert.equal(fileCreates, 0);
  assert.equal(
    host.diskByPath.has(`/storage/${keys.attachmentKey}/arxiv-2401.01234-v2.pdf`),
    false,
  );
});

test("native arXiv file commit stops before creation without synchronous byte evidence", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  const stagedBytes = new Uint8Array([37, 80, 68, 70, 45, 111, 112, 113]);
  const fingerprint = `sha256:${createHash("sha256").update(stagedBytes).digest("hex")}`;
  let fileCreates = 0;
  env.accessGate = gate;
  env.arxivFileFingerprint = undefined;
  env.arxivStaging = {
    async installCreateOnly(_stagingId, _destination, _fileName, commitValidatedCreate) {
      await commitValidatedCreate(() => {
        fileCreates += 1;
      });
    },
  };
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const empty = await native.inspectArxiv(arxivSource);
  const keys = await native.planArxivImportKeys(true);
  await native.createArxivParent({
    source: arxivSource,
    itemKey: keys.itemKey,
    operationMarker: "urn:zotero-ai-research-companion:operation:no-sync-parent",
    parentProvenance: arxivParentProvenance(arxivSource),
    expectedCandidates: empty.candidates,
    accessFence: fence,
  });
  const afterParent = await native.inspectArxiv(arxivSource);
  await native.createArxivAttachment({
    source: arxivSource,
    itemKey: keys.itemKey,
    attachmentKey: keys.attachmentKey,
    operationMarker: "urn:zotero-ai-research-companion:operation:no-sync-attachment",
    attachmentProvenance: arxivAttachmentProvenance(arxivSource, fingerprint),
    expectedCandidates: afterParent.candidates,
    accessFence: fence,
  });
  const afterAttachment = await native.inspectArxiv(arxivSource);

  await assert.rejects(
    native.installArxivPdf({
      source: arxivSource,
      itemKey: keys.itemKey,
      attachmentKey: keys.attachmentKey,
      stagedPdf: {
        stagingId: "owned-no-sync-stage",
        source: { arxivId: arxivSource.arxivId, version: arxivSource.version },
        fingerprint,
        byteLength: stagedBytes.byteLength,
        pageCount: 1,
      },
      expectedCandidates: afterAttachment.candidates,
      accessFence: fence,
    }),
    (error) =>
      error instanceof CoreOperationError && error.code === "unsupported_capability",
  );
  assert.equal(fileCreates, 0);
  assert.equal(host.diskByPath.size, 0);
});

test("native arXiv creation commits prospective identities, installs create-only bytes, and confirms exact readback", async () => {
  const { env, host } = fixtureEnvironment();
  const gate = new MutableZoteroAccessGate(true);
  const stagedBytes = new Uint8Array([37, 80, 68, 70, 45, 10, 20, 30]);
  const digest = await webcrypto.subtle.digest("SHA-256", stagedBytes);
  const fingerprint = `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
  const installs = [];
  let beforeFileCreate;
  let duringDigest;
  let fileCreates = 0;
  env.crypto = {
    subtle: {
      async digest(algorithm, data) {
        await duringDigest?.(data);
        return webcrypto.subtle.digest(algorithm, data);
      },
    },
  };
  env.accessGate = gate;
  env.arxivStaging = {
    async installCreateOnly(stagingId, destination, fileName, commitValidatedCreate) {
      installs.push({ stagingId, destination, fileName });
      assert.equal(typeof commitValidatedCreate, "function");
      await beforeFileCreate?.();
      await commitValidatedCreate(() => {
        const path = `${destination}/${fileName}`;
        assert.equal(host.diskByPath.has(path), false);
        fileCreates += 1;
        host.diskByPath.set(path, Uint8Array.from(stagedBytes));
        host.readerBytes = Uint8Array.from(stagedBytes);
      });
    },
  };
  const native = createZoteroNativeApi(env);
  const fence = native.captureArxivAccessFence();
  const before = await native.inspectArxiv(arxivSource);
  assert.deepEqual(before.candidates, []);
  const plan = await native.planArxivImportKeys(true);
  assert.notEqual(plan.itemKey, plan.attachmentKey);
  const marker = "urn:zotero-ai-research-companion:operation:native-arxiv:digest";

  const parent = await native.createArxivParent({
    source: arxivSource,
    itemKey: plan.itemKey,
    operationMarker: marker,
    parentProvenance: arxivParentProvenance(arxivSource),
    expectedCandidates: before.candidates,
    accessFence: fence,
  });
  assert.equal(parent.metadataMatchesSource, true);
  const parentItem = [...host.items.values()].find((item) => item.key === plan.itemKey);
  assert.deepEqual(parentItem.getCollections(), []);
  assert.equal(parentItem.getField("title"), arxivSource.metadata.title);
  assert.deepEqual(parentItem.getCreators().map((creator) => creator.name), arxivSource.metadata.authors);
  assert.deepEqual(host.primaryDataLoads, [
    { itemType: "preprint", key: plan.itemKey },
  ]);

  const afterParent = await native.inspectArxiv(arxivSource);
  await native.createArxivAttachment({
    source: arxivSource,
    itemKey: plan.itemKey,
    attachmentKey: plan.attachmentKey,
    operationMarker: marker,
    attachmentProvenance: arxivAttachmentProvenance(arxivSource, fingerprint),
    expectedCandidates: afterParent.candidates,
    accessFence: fence,
  });
  assert.deepEqual(host.primaryDataLoads, [
    { itemType: "preprint", key: plan.itemKey },
    { itemType: "attachment", key: plan.attachmentKey },
  ]);
  const afterAttachment = await native.inspectArxiv(arxivSource);
  const installed = await native.installArxivPdf({
    source: arxivSource,
    itemKey: plan.itemKey,
    attachmentKey: plan.attachmentKey,
    stagedPdf: {
      stagingId: "owned-native-stage",
      source: { arxivId: arxivSource.arxivId, version: arxivSource.version },
      fingerprint,
      byteLength: stagedBytes.byteLength,
      pageCount: 1,
    },
    expectedCandidates: afterAttachment.candidates,
    accessFence: fence,
  });

  assert.equal(installed.fingerprint, fingerprint);
  assert.equal(installed.readable, true);
  assert.equal(installed.pageCount, 1);
  assert.equal(installed.identity, "verified");
  assert.equal(installed.canonicalSourceEvidence, true);
  assert.equal(installed.version, 2);
  assert.deepEqual(installed.operationMarkers, [marker]);
  assert.deepEqual(installs, [{
    stagingId: "owned-native-stage",
    destination: `/storage/${plan.attachmentKey}`,
    fileName: "arxiv-2401.01234-v2.pdf",
  }]);
  assert.equal(host.items.get(1).getDisplayTitle(), "Fixture paper");

  const guardedPlan = await native.planArxivImportKeys(false);
  const beforeGuardedAttachment = await native.inspectArxiv(arxivSource);
  await native.createArxivAttachment({
    source: arxivSource,
    itemKey: plan.itemKey,
    attachmentKey: guardedPlan.attachmentKey,
    operationMarker: `${marker}:guarded`,
    attachmentProvenance: arxivAttachmentProvenance(arxivSource, fingerprint),
    expectedCandidates: beforeGuardedAttachment.candidates,
    accessFence: fence,
  });
  const beforeGuardedInstall = await native.inspectArxiv(arxivSource);
  beforeFileCreate = async () => {
    parentItem.setField("title", "Concurrent manual title edit during installer preparation");
    await parentItem.saveTx();
    beforeFileCreate = undefined;
  };
  await assert.rejects(
    native.installArxivPdf({
      source: arxivSource,
      itemKey: plan.itemKey,
      attachmentKey: guardedPlan.attachmentKey,
      stagedPdf: {
        stagingId: "owned-guarded-stage",
        source: { arxivId: arxivSource.arxivId, version: arxivSource.version },
        fingerprint,
        byteLength: stagedBytes.byteLength,
        pageCount: 1,
      },
      expectedCandidates: beforeGuardedInstall.candidates,
      accessFence: fence,
    }),
    /changed during file preparation/i,
  );
  assert.equal(fileCreates, 1);
  assert.equal(
    host.diskByPath.has(`/storage/${guardedPlan.attachmentKey}/arxiv-2401.01234-v2.pdf`),
    false,
  );

  const duplicateGuardPlan = await native.planArxivImportKeys(false);
  const beforeDuplicateAttachment = await native.inspectArxiv(arxivSource);
  await native.createArxivAttachment({
    source: arxivSource,
    itemKey: plan.itemKey,
    attachmentKey: duplicateGuardPlan.attachmentKey,
    operationMarker: `${marker}:duplicate-guarded`,
    attachmentProvenance: arxivAttachmentProvenance(arxivSource, fingerprint),
    expectedCandidates: beforeDuplicateAttachment.candidates,
    accessFence: fence,
  });
  const beforeDuplicateInstall = await native.inspectArxiv(arxivSource);
  beforeFileCreate = async () => {
    const duplicateParent = new FakeItem(host, "journalArticle", {
      key: "RACEPARENT",
      fields: {
        title: "Concurrent canonical parent",
        extra: "arXiv:2401.01234v2",
      },
    });
    await duplicateParent.saveTx();
    beforeFileCreate = undefined;
  };
  await assert.rejects(
    native.installArxivPdf({
      source: arxivSource,
      itemKey: plan.itemKey,
      attachmentKey: duplicateGuardPlan.attachmentKey,
      stagedPdf: {
        stagingId: "owned-duplicate-guarded-stage",
        source: { arxivId: arxivSource.arxivId, version: arxivSource.version },
        fingerprint,
        byteLength: stagedBytes.byteLength,
        pageCount: 1,
      },
      expectedCandidates: beforeDuplicateInstall.candidates,
      accessFence: fence,
    }),
    /changed during file preparation/i,
  );
  assert.equal(fileCreates, 1);
  assert.equal(
    host.diskByPath.has(
      `/storage/${duplicateGuardPlan.attachmentKey}/arxiv-2401.01234-v2.pdf`,
    ),
    false,
  );

  const digestRacePlan = await native.planArxivImportKeys(false);
  const beforeDigestRaceAttachment = await native.inspectArxiv(arxivSource);
  await native.createArxivAttachment({
    source: arxivSource,
    itemKey: plan.itemKey,
    attachmentKey: digestRacePlan.attachmentKey,
    operationMarker: `${marker}:digest-race`,
    attachmentProvenance: arxivAttachmentProvenance(arxivSource, fingerprint),
    expectedCandidates: beforeDigestRaceAttachment.candidates,
    accessFence: fence,
  });
  const beforeDigestRaceInstall = await native.inspectArxiv(arxivSource);
  beforeFileCreate = async () => {
    duringDigest = async (data) => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const material = new TextDecoder().decode(bytes);
      if (
        !material.includes(`\"itemKey\":\"${plan.itemKey}\"`) ||
        !material.includes("\"attachments\"")
      ) {
        return;
      }
      duringDigest = undefined;
      const racePath = "/race/matching-v2.pdf";
      host.diskByPath.set(racePath, Uint8Array.from(stagedBytes));
      const matchingPdf = new FakeItem(host, "attachment", {
        key: "DIGESTRACE",
        parentItemID: parentItem.id,
        attachmentContentType: "application/pdf",
        filePath: racePath,
        fields: {
          title: "Concurrent exact-version PDF",
          url: arxivSource.pdfUrl,
        },
      });
      await matchingPdf.saveTx();
    };
    beforeFileCreate = undefined;
  };
  await assert.rejects(
    native.installArxivPdf({
      source: arxivSource,
      itemKey: plan.itemKey,
      attachmentKey: digestRacePlan.attachmentKey,
      stagedPdf: {
        stagingId: "owned-digest-race-stage",
        source: { arxivId: arxivSource.arxivId, version: arxivSource.version },
        fingerprint,
        byteLength: stagedBytes.byteLength,
        pageCount: 1,
      },
      expectedCandidates: beforeDigestRaceInstall.candidates,
      accessFence: fence,
    }),
    /changed during file preparation/i,
  );
  assert.equal(fileCreates, 1);
  assert.equal(
    host.diskByPath.has(
      `/storage/${digestRacePlan.attachmentKey}/arxiv-2401.01234-v2.pdf`,
    ),
    false,
  );
});
