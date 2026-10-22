import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { JSDOM } from "jsdom";

import { CoreOperationError } from "../../dist/core/index.js";
import {
  ARXIV_PROVENANCE_RELATION_PREDICATE,
  MutableZoteroAccessGate,
  DomPurifyNativeNoteContentPolicy,
  OPERATION_RELATION_PREDICATE,
  arxivAttachmentProvenance,
  arxivParentProvenance,
  createZoteroNativeApi,
} from "../../dist/adapters/zotero/index.js";

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
  constructor(host, itemType, values = {}) {
    this.host = host;
    this.itemType = itemType;
    this.id = values.id;
    this.key = values.key;
    this.libraryID = values.libraryID ?? 1;
    this.parentItemID = values.parentItemID;
    this.version = values.version ?? 1;
    this.dateModified = values.dateModified ?? "2026-10-21 10:00:00";
    this.relations = new Map();
    Object.assign(this, values);
  }

  async loadAllData() {
    await this.host.onLoadAllData?.(this);
    if (this.isNote() && typeof this.note === "string") {
      const match = this.note.match(/^<div class="zotero-note znv[0-9]+">([\s\S]*)<\/div>$/u);
      if (match) this.note = match[1];
    }
  }
  get parentID() { return this.parentItemID; }
  set parentID(value) { this.parentItemID = value; }
  isPDFAttachment() { return this.itemType === "attachment"; }
  isRegularItem() { return this.itemType === "journalArticle" || this.itemType === "preprint"; }
  isAnnotation() { return this.itemType === "annotation"; }
  isNote() { return this.itemType === "note"; }
  isEditable() { return true; }
  getField(field) { return this.fields?.[field] ?? ""; }
  setField(field, value) {
    this.fields ??= {};
    this.fields[field] = value;
  }
  getDisplayTitle() { return this.fields?.title ?? ""; }
  getCreators() { return structuredClone(this.creators ?? []); }
  setCreators(creators) { this.creators = structuredClone(creators); }
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
  getFilePathAsync() {
    if (this.filePath === false) return Promise.resolve(false);
    if (typeof this.filePath === "string") return Promise.resolve(this.filePath);
    if (typeof this.attachmentPath === "string" && this.attachmentPath.startsWith("storage:")) {
      return Promise.resolve(`/storage/${this.key}/${this.attachmentPath.slice("storage:".length)}`);
    }
    return Promise.resolve("/fixture/paper.pdf");
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
    if (!this.id) this.id = this.host.nextId++;
    if (!this.key) this.key = `KEY${String(this.id).padStart(5, "0")}`;
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
    generatedKeyNumber: 1,
    diskByPath: new Map(),
    stagedBytes: new Map(),
    clientVersion: 1,
    transactionWaiters: 0,
    onItemsGetAll: undefined,
  };
  let transactionTail = Promise.resolve();
  let transactionCount = 0;
  let transactionVersionIncremented = false;
  host.db = {
    active: false,
    async executeTransaction(work) {
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
      try {
        return await work();
      } finally {
        this.active = false;
        transactionCount -= 1;
        release();
      }
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
      getAll() { return [personalLibrary]; },
      get() { return personalLibrary; },
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
      async getByLibraryAndKeyAsync(libraryID, key) { return byLibraryKey(libraryID, key); },
      async getAsync(ids) {
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
      constructor(type) { super(host, type); }
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
          const value = host.diskByPath.get(path);
          if (value !== undefined) return Uint8Array.from(value);
          if (path === "/fixture/paper.pdf") return Uint8Array.from(host.diskBytes);
          throw new Error("fixture file missing");
        },
      },
      crypto: webcrypto,
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

  await assert.rejects(pending, /access changed before native arXiv commit/i);
  assert.equal([...host.items.values()].some((item) => item.key === plan.itemKey), false);
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
