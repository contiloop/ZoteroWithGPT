import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { CoreOperationError } from "../../dist/core/index.js";
import {
  MutableZoteroAccessGate,
  OPERATION_RELATION_PREDICATE,
  createZoteroNativeApi,
} from "../../dist/adapters/zotero/index.js";

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
    if (this.isNote() && typeof this.note === "string") {
      const match = this.note.match(/^<div class="zotero-note znv[0-9]+">([\s\S]*)<\/div>$/u);
      if (match) this.note = match[1];
    }
  }
  get parentID() { return this.parentItemID; }
  set parentID(value) { this.parentItemID = value; }
  isPDFAttachment() { return this.itemType === "attachment"; }
  isRegularItem() { return this.itemType === "journalArticle"; }
  isAnnotation() { return this.itemType === "annotation"; }
  isNote() { return this.itemType === "note"; }
  isEditable() { return true; }
  getField(field) { return this.fields?.[field] ?? ""; }
  getDisplayTitle() { return this.fields?.title ?? ""; }
  getFilePathAsync() { return Promise.resolve("/fixture/paper.pdf"); }
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
  setNote(content) { this.note = content; }
  getNote() { return this.note; }
  getNoteTitle() { return "Fixture note"; }
  async saveTx() {
    if (!this.id) this.id = this.host.nextId++;
    if (!this.key) this.key = `KEY${String(this.id).padStart(5, "0")}`;
    this.version += 1;
    this.host.items.set(this.id, this);
    this.host.savedSnapshots.push({
      key: this.key,
      comment: this.annotationComment,
      relations: structuredClone(Object.fromEntries(this.relations)),
    });
    return this.id;
  }
}

function fixtureEnvironment() {
  const readerRealmRequest = Symbol("readerRealmRequest");
  const host = {
    items: new Map(),
    nextId: 10,
    savedSnapshots: [],
    diskBytes: new Uint8Array([1, 2, 3, 4]),
    readerBytes: new Uint8Array([1, 2, 3, 4]),
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
  const reader = {
    itemID: 2,
    _initPromise: Promise.resolve(),
    _internalReader: {
      _state: { annotations: [] },
      _primaryView: {
        initializedPromise: Promise.resolve(),
        getAnnotationMeta() { return { sortIndex: "00000|000001|00020", pageLabel: "1" }; },
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
    Items: {
      async getByLibraryAndKeyAsync(libraryID, key) { return byLibraryKey(libraryID, key); },
      async getAsync(ids) {
        if (Array.isArray(ids)) return ids.map((id) => host.items.get(id)).filter(Boolean);
        return host.items.get(ids) ?? false;
      },
      get(id) { return host.items.get(id); },
    },
    Reader: {
      _readers: [reader],
      async open() { return reader; },
    },
    API: { getLibraryPrefix() { return "library"; } },
    DataObjectUtilities: { generateKey() { return "ANN00001"; } },
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
      IOUtils: { async read() { return Uint8Array.from(host.diskBytes); } },
      crypto: webcrypto,
      cloneInto(value, target) {
        assert.equal(
          target,
          reader._internalReader._primaryView._iframeWindow,
          "worker-bound data must be cloned into the PDF frame realm",
        );
        return { ...structuredClone(value), [readerRealmRequest]: true };
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

test("a connected laid-out annotation node is rendered viewer evidence", async () => {
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
  host.reader._internalReader._primaryView._iframeWindow.document = {
    defaultView: { innerWidth: 800, innerHeight: 600 },
    querySelector(selector) {
      if (!selector.includes(created.annotationKey)) return null;
      return {
        isConnected: true,
        getClientRects() { return { length: 1 }; },
        getBoundingClientRect() {
          return { left: 10, right: 17, top: 20, bottom: 30 };
        },
      };
    },
  };

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), true);
});

test("a laid-out annotation outside the PDF viewport is not viewer evidence", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const attachment = await native.getPdfAttachment("1", "ATTACH01", "ITEM0001");
  const created = await native.createAnnotation({
    anchor: { ...anchor, attachmentFingerprint: attachment.fingerprint },
    type: "highlight",
    comment: "",
    color: "#ffd400",
    operationMarker: "urn:offscreen-dom",
  });
  host.reader._internalReader._primaryView._iframeWindow.document = {
    defaultView: { innerWidth: 800, innerHeight: 600 },
    querySelector() {
      return {
        isConnected: true,
        getClientRects() { return { length: 1 }; },
        getBoundingClientRect() {
          return { left: -300, right: -200, top: 20, bottom: 30 };
        },
      };
    },
  };

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
    isConnected: true,
    getClientRects() { return { length: 1 }; },
    getBoundingClientRect() { return rect; },
  };
  host.reader._iframeWindow = {
    document: {
      defaultView: { innerWidth: 800, innerHeight: 600 },
      querySelector(selector) {
        if (!selector.includes(created.annotationKey)) return null;
        return {
          isConnected: true,
          getClientRects() { return { length: 1 }; },
          getBoundingClientRect() { return rect; },
          querySelector() { return content; },
        };
      },
    },
  };

  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), false);
  host.reader._internalReader._state.sidebarOpen = true;
  assert.equal(await native.annotationVisible("1", "ATTACH01", created.annotationKey), true);
});

test("native child-note updates use fresh content and preserve a concurrent manual edit", async () => {
  const { env, host } = fixtureEnvironment();
  const native = createZoteroNativeApi(env);
  const created = await native.createNote({
    libraryId: "1",
    itemKey: "ITEM0001",
    content: '<div class="zotero-note znv1"><p>Initial fixture note</p></div>',
    operationMarker: "urn:note-create",
  });
  assert.deepEqual(created.operationMarkers, ["urn:note-create"]);

  const updated = await native.updateNote({
    expected: created,
    content: '<div class="zotero-note znv1"><p>Updated fixture note</p></div>',
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
        content: '<div class="zotero-note znv1"><p>Must not replace manual edit</p></div>',
        operationMarker: "urn:note-stale",
      }),
    (error) => error instanceof CoreOperationError && error.code === "conflict",
  );
  assert.match(item.note, /Manual edit/);
});
