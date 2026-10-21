import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { JSDOM } from "jsdom";

import { CoreOperationError } from "../../dist/core/index.js";
import {
  ZoteroLibraryAdapter,
  ZoteroOperationRecovery,
  DomPurifyNativeNoteContentPolicy,
  operationIdentityMarker,
} from "../../dist/adapters/zotero/index.js";
import { MAX_TEXT_BYTES } from "../../dist/protocol/index.js";

class Sha256Digest {
  async digest(bytes) {
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  }
}

const anchor = {
  libraryId: "1",
  itemKey: "ITEM0001",
  attachmentKey: "ATTACH01",
  attachmentFingerprint: "sha256:pdf-a",
  pageIndex: 0,
  pageLabel: "1",
  rectangles: [{ x1: 10, y1: 20, x2: 80, y2: 31 }],
  selectedText: "posterior concentration",
  matchEvidence: {
    method: "exact_quote",
    matchedText: "posterior concentration",
    exact: true,
  },
};

function createAnnotationRequest(comment = "Full explanation") {
  return {
    protocolVersion: 1,
    operationId: "op-create-1",
    operation: "create_annotation",
    profileId: "profile-A",
    authorization: { kind: "explicit_request", scope: "Save on ATTACH01" },
    payload: { anchor, type: "highlight", comment, color: "#ffd400" },
  };
}

function updateAnnotationRequest(revision, mode = "append", comment = "Added by the researcher") {
  return {
    protocolVersion: 1,
    operationId: "op-update-1",
    operation: "update_annotation",
    profileId: "profile-A",
    authorization: { kind: "explicit_request", scope: "Update ANN00001" },
    payload: {
      libraryId: "1",
      attachmentKey: "ATTACH01",
      annotationKey: "ANN00001",
      expectedRevision: revision,
      mode,
      comment,
    },
  };
}

class NativeApiDouble {
  fingerprint = "sha256:pdf-a";
  created = 0;
  updated = 0;
  notesCreated = 0;
  notesUpdated = 0;
  annotations = new Map();
  notes = new Map();

  async runtimeStatus() {
    return { zoteroVersion: "10.0.6-runtime", profileName: "Test Profile" };
  }

  async searchPapers() {
    return [
      {
        libraryId: "1",
        itemKey: "ITEM0001",
        title: "Same title",
        creators: ["Ada Lovelace"],
        year: 2025,
        attachments: [
          {
            attachmentKey: "ATTACH01",
            title: "Accepted manuscript",
            contentType: "application/pdf",
            fingerprint: "sha256:pdf-a",
          },
          {
            attachmentKey: "ATTACH02",
            title: "Supplement",
            contentType: "application/pdf",
            fingerprint: "sha256:pdf-supplement",
          },
        ],
      },
      {
        libraryId: "2",
        itemKey: "ITEM0002",
        title: "Same title",
        creators: ["Grace Hopper"],
        attachments: [],
      },
    ];
  }

  async getPdfAttachment(libraryId, attachmentKey, itemKey) {
    if (libraryId !== "1" || attachmentKey !== "ATTACH01") return undefined;
    if (itemKey && itemKey !== "ITEM0001") return undefined;
    return {
      libraryId,
      itemKey: "ITEM0001",
      attachmentKey,
      title: "Accepted manuscript",
      contentType: "application/pdf",
      fingerprint: this.fingerprint,
      revision: `${this.fingerprint}:native-1`,
      pageCount: 1,
    };
  }

  async readPdfPage(attachment, pageIndex) {
    assert.equal(attachment.attachmentKey, "ATTACH01");
    return {
      pageIndex,
      pageLabel: "1",
      viewBox: [0, 0, 600, 800],
      chars: [],
    };
  }

  async listAnnotations() {
    return [...this.annotations.values()].map((value) => structuredClone(value));
  }

  async getAnnotation(_libraryId, _attachmentKey, annotationKey) {
    const value = this.annotations.get(annotationKey);
    return value ? structuredClone(value) : undefined;
  }

  async createAnnotation(input) {
    this.created += 1;
    const record = {
      libraryId: input.anchor.libraryId,
      itemKey: input.anchor.itemKey,
      attachmentKey: input.anchor.attachmentKey,
      annotationKey: "ANN00001",
      type: input.type,
      text: input.anchor.selectedText,
      comment: input.comment,
      color: input.color,
      pageIndex: input.anchor.pageIndex,
      pageLabel: input.anchor.pageLabel,
      rectangles: input.anchor.rectangles,
      version: 0,
      dateModified: "2026-10-21 10:00:00",
      operationMarkers: [input.operationMarker],
    };
    this.annotations.set(record.annotationKey, structuredClone(record));
    return structuredClone(record);
  }

  async updateAnnotation(input) {
    const current = this.annotations.get(input.expected.annotationKey);
    if (!current || JSON.stringify(current) !== JSON.stringify(input.expected)) {
      throw new CoreOperationError("conflict", "Native annotation changed before commit");
    }
    this.updated += 1;
    const next = {
      ...current,
      comment: input.comment,
      dateModified: "2026-10-21 10:00:01",
      operationMarkers: [...current.operationMarkers, input.operationMarker],
    };
    this.annotations.set(next.annotationKey, structuredClone(next));
    return structuredClone(next);
  }

  async listNotes() {
    return [...this.notes.values()].map((value) => structuredClone(value));
  }

  async getNote(_libraryId, _itemKey, noteKey) {
    const value = this.notes.get(noteKey);
    return value ? structuredClone(value) : undefined;
  }

  async createNote() {
    const input = arguments[0];
    this.notesCreated += 1;
    const wrapper = input.content.match(
      /^<div class="zotero-note znv[0-9]+">([\s\S]*)<\/div>$/u,
    );
    const record = {
      libraryId: input.libraryId,
      itemKey: input.itemKey,
      noteKey: "NOTE0001",
      title: "Requested note",
      content: (wrapper ? wrapper[1] : input.content)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
        .trim(),
      version: 1,
      dateModified: "2026-10-21 10:00:00",
      operationMarkers: [input.operationMarker],
    };
    this.notes.set(record.noteKey, structuredClone(record));
    return structuredClone(record);
  }

  async updateNote() {
    const input = arguments[0];
    const current = this.notes.get(input.expected.noteKey);
    if (!current) throw new Error("note missing");
    this.notesUpdated += 1;
    const wrapper = input.content.match(
      /^<div class="zotero-note znv[0-9]+">([\s\S]*)<\/div>$/u,
    );
    const record = {
      ...current,
      content: (wrapper ? wrapper[1] : input.content)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
        .trim(),
      version: current.version + 1,
      dateModified: "2026-10-21 10:00:01",
      operationMarkers: [...current.operationMarkers, input.operationMarker],
    };
    this.notes.set(record.noteKey, structuredClone(record));
    return structuredClone(record);
  }

  async annotationVisible(_libraryId, _attachmentKey, annotationKey) {
    return this.annotations.has(annotationKey);
  }

  async findByOperationMarker(marker) {
    return [
      ...[...this.annotations.values()].filter((x) => x.operationMarkers.includes(marker)),
      ...[...this.notes.values()].filter((x) => x.operationMarkers.includes(marker)),
    ].map((value) => structuredClone(value));
  }
}

function adapter(native = new NativeApiDouble()) {
  const noteContent = new DomPurifyNativeNoteContentPolicy({ window: new JSDOM("").window });
  return new ZoteroLibraryAdapter({
    native,
    noteContent,
    digest: new Sha256Digest(),
    profileId: "profile-A",
    pluginVersion: "0.1.0",
    enabled: true,
    transport: { kind: "custom", description: "Test transport" },
  });
}

function windowLikeWithDocument(window, document) {
  return {
    document,
    DocumentFragment: window.DocumentFragment,
    HTMLTemplateElement: window.HTMLTemplateElement,
    Node: window.Node,
    Element: window.Element,
    NodeFilter: window.NodeFilter,
    NamedNodeMap: window.NamedNodeMap,
    HTMLFormElement: window.HTMLFormElement,
    DOMParser: window.DOMParser,
  };
}

test("paper discovery returns ambiguous titles and every PDF candidate", async () => {
  const result = await adapter().searchPapers({
    protocolVersion: 1,
    operationId: "op-search",
    operation: "search_papers",
    profileId: "profile-A",
    payload: { query: "Same title", limit: 10 },
  });

  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].title, result.matches[1].title);
  assert.deepEqual(
    result.matches[0].attachments.map((x) => x.attachmentKey),
    ["ATTACH01", "ATTACH02"],
  );
});

test("create annotation rejects a changed attachment before a native write", async () => {
  const native = new NativeApiDouble();
  native.fingerprint = "sha256:replacement";
  const library = adapter(native);

  await assert.rejects(
    () =>
      library.createAnnotation(createAnnotationRequest(), anchor, {
        operationId: "op-create-1",
        requestDigest: "sha256:request-a",
      }),
    (error) => error instanceof CoreOperationError && error.code === "stale_attachment",
  );
  assert.equal(native.created, 0);
});

test("annotation append preserves the existing comment and refuses a concurrent edit", async () => {
  const native = new NativeApiDouble();
  native.annotations.set("ANN00001", {
    libraryId: "1",
    itemKey: "ITEM0001",
    attachmentKey: "ATTACH01",
    annotationKey: "ANN00001",
    type: "highlight",
    text: "posterior concentration",
    comment: "Human comment",
    color: "#ffd400",
    pageIndex: 0,
    pageLabel: "1",
    rectangles: anchor.rectangles,
    version: 1,
    dateModified: "2026-10-21 10:00:00",
    operationMarkers: [],
  });
  const library = adapter(native);
  const listed = await library.listAnnotations({
    protocolVersion: 1,
    operationId: "op-list",
    operation: "list_annotations",
    profileId: "profile-A",
    payload: { libraryId: "1", attachmentKey: "ATTACH01" },
  });
  const revision = listed.annotations[0].revision;

  const updated = await library.updateAnnotation(updateAnnotationRequest(revision), {
    operationId: "op-update-1",
    requestDigest: "sha256:request-update",
  });
  assert.equal(updated.comment, "Human comment\n\nAdded by the researcher");
  assert.equal(native.updated, 1);

  const staleRevision = updated.revision;
  native.annotations.get("ANN00001").comment += "\n\nManual sync edit";
  native.annotations.get("ANN00001").dateModified = "2026-10-21 10:00:02";
  await assert.rejects(
    () =>
      library.updateAnnotation(updateAnnotationRequest(staleRevision), {
        operationId: "op-update-2",
        requestDigest: "sha256:request-update-2",
      }),
    (error) => error instanceof CoreOperationError && error.code === "conflict",
  );
  assert.equal(native.updated, 1);
  assert.match(native.annotations.get("ANN00001").comment, /Manual sync edit/);
});

test("annotation append enforces the final UTF-8 limit before the native writer", async () => {
  const makeNative = (comment) => {
    const native = new NativeApiDouble();
    native.annotations.set("ANN00001", {
      libraryId: "1",
      itemKey: "ITEM0001",
      attachmentKey: "ATTACH01",
      annotationKey: "ANN00001",
      type: "highlight",
      text: "posterior concentration",
      comment,
      color: "#ffd400",
      pageIndex: 0,
      pageLabel: "1",
      rectangles: anchor.rectangles,
      version: 1,
      dateModified: "2026-10-21 10:00:00",
      operationMarkers: [],
    });
    return native;
  };
  const currentAtBoundary = "a".repeat(MAX_TEXT_BYTES - 5);
  const allowedNative = makeNative(currentAtBoundary);
  const allowedLibrary = adapter(allowedNative);
  const allowedList = await allowedLibrary.listAnnotations({
    protocolVersion: 1,
    operationId: "op-list-boundary-allowed",
    operation: "list_annotations",
    profileId: "profile-A",
    payload: { libraryId: "1", attachmentKey: "ATTACH01" },
  });
  const allowed = await allowedLibrary.updateAnnotation(
    updateAnnotationRequest(allowedList.annotations[0].revision, "append", "가"),
    { operationId: "op-annotation-boundary-allowed", requestDigest: "sha256:allowed" },
  );
  assert.equal(new TextEncoder().encode(allowed.comment).byteLength, MAX_TEXT_BYTES);
  assert.equal(allowedNative.updated, 1);

  const overflowingNative = makeNative("a".repeat(MAX_TEXT_BYTES - 4));
  const overflowingLibrary = adapter(overflowingNative);
  const overflowingList = await overflowingLibrary.listAnnotations({
    protocolVersion: 1,
    operationId: "op-list-boundary-overflow",
    operation: "list_annotations",
    profileId: "profile-A",
    payload: { libraryId: "1", attachmentKey: "ATTACH01" },
  });
  await assert.rejects(
    () =>
      overflowingLibrary.updateAnnotation(
        updateAnnotationRequest(overflowingList.annotations[0].revision, "append", "가"),
        { operationId: "op-annotation-boundary-overflow", requestDigest: "sha256:overflow" },
      ),
    (error) => error instanceof CoreOperationError && error.code === "too_large",
  );
  assert.equal(overflowingNative.updated, 0);
});

test("storage readback requires the committed operation identity marker", async () => {
  const native = new NativeApiDouble();
  const library = adapter(native);
  const identity = { operationId: "op-create-1", requestDigest: "sha256:request-a" };
  const created = await library.createAnnotation(createAnnotationRequest(), anchor, identity);

  const confirmed = await library.confirmAnnotation(
    {
      libraryId: "1",
      attachmentKey: "ATTACH01",
      annotationKey: created.annotationKey,
      expectedRevision: created.revision,
    },
    identity,
  );
  assert.equal(confirmed.confirmed, true);

  native.annotations.get(created.annotationKey).operationMarkers = [];
  const missingMarker = await library.confirmAnnotation(
    {
      libraryId: "1",
      attachmentKey: "ATTACH01",
      annotationKey: created.annotationKey,
      expectedRevision: created.revision,
    },
    identity,
  );
  assert.equal(missingMarker.confirmed, false);
  assert.match(missingMarker.description, /identity/i);
});

test("crash recovery observes a committed marker and never invokes a writer", async () => {
  const native = new NativeApiDouble();
  const library = adapter(native);
  const identity = { operationId: "op-create-1", requestDigest: "sha256:request-a" };
  await library.createAnnotation(createAnnotationRequest(), anchor, identity);
  const recovery = new ZoteroOperationRecovery(native, new Sha256Digest());
  const runningRecord = {
    protocolVersion: 1,
    operationId: identity.operationId,
    requestDigest: identity.requestDigest,
    operation: "create_annotation",
    profileId: "profile-A",
    mutation: true,
    state: "running",
    response: {
      protocolVersion: 1,
      operationId: identity.operationId,
      state: "running",
      data: null,
      error: null,
      verification: { storage: "not_checked", viewer: "not_checked" },
    },
  };

  const outcome = await recovery.reconcile(runningRecord);
  assert.equal(outcome.kind, "completed");
  assert.equal(outcome.data.annotationKey, "ANN00001");
  assert.equal(outcome.verification.storage, "confirmed");
  assert.equal(native.created, 1);

  native.annotations.clear();
  const unknown = await recovery.reconcile(runningRecord);
  assert.equal(unknown.kind, "indeterminate");
  assert.equal(unknown.error.code, "unknown_outcome");
  assert.equal(native.created, 1);
});

test("operation markers bind both the operation ID and canonical request digest", () => {
  assert.notEqual(
    operationIdentityMarker({ operationId: "same", requestDigest: "sha256:a" }),
    operationIdentityMarker({ operationId: "same", requestDigest: "sha256:b" }),
  );
});

test("child-note commit readback compares Zotero's wrapper-free note body", async () => {
  const native = new NativeApiDouble();
  const library = adapter(native);
  const result = await library.createNote(
    {
      protocolVersion: 1,
      operationId: "op-create-note",
      operation: "create_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Create child note on ITEM0001" },
      payload: {
        libraryId: "1",
        itemKey: "ITEM0001",
        content: "<p>Explicit synthesis note</p>",
      },
    },
    { operationId: "op-create-note", requestDigest: "sha256:note-request" },
  );

  assert.equal(result.content, "<p>Explicit synthesis note</p>");
  assert.equal(native.notes.get(result.noteKey).content, result.content);
});

test("child-note replacement confirms the wrapper-free body returned by Zotero", async () => {
  const native = new NativeApiDouble();
  native.notes.set("NOTE0001", {
    libraryId: "1",
    itemKey: "ITEM0001",
    noteKey: "NOTE0001",
    title: "Existing note",
    content: "<p>Existing body</p>",
    version: 1,
    dateModified: "2026-10-21 10:00:00",
    operationMarkers: [],
  });
  const library = adapter(native);
  const current = await library.readNote({
    protocolVersion: 1,
    operationId: "op-read-note",
    operation: "read_note",
    profileId: "profile-A",
    payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
  });
  const result = await library.updateNote(
    {
      protocolVersion: 1,
      operationId: "op-replace-note",
      operation: "update_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Replace NOTE0001" },
      payload: {
        libraryId: "1",
        itemKey: "ITEM0001",
        noteKey: "NOTE0001",
        expectedRevision: current.revision,
        mode: "replace",
        content: '<div class="zotero-note znv1"><p>Replacement body</p></div>',
      },
    },
    { operationId: "op-replace-note", requestDigest: "sha256:replace-note" },
  );

  assert.equal(result.content, "<p>Replacement body</p>");
});

test("child-note creation stores remote-resource and executable markup as inert readable text", async () => {
  const native = new NativeApiDouble();
  const library = adapter(native);
  const result = await library.createNote(
    {
      protocolVersion: 1,
      operationId: "op-create-unsafe-note",
      operation: "create_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Create a safe child note" },
      payload: {
        libraryId: "1",
        itemKey: "ITEM0001",
        content:
          '<p>Approved study proof</p><img src="https://example.invalid/probe.png" alt="diagram evidence"><script>script words</script><iframe src="https://example.invalid/frame">frame words</iframe>\n',
      },
    },
    { operationId: "op-create-unsafe-note", requestDigest: "sha256:create-unsafe-note" },
  );

  assert.doesNotMatch(result.content, /<(?:img|script|iframe)\b/iu);
  assert.match(result.content, /Approved study proof/u);
  assert.match(result.content, /diagram evidence/u);
  assert.match(result.content, /script words/u);
  assert.match(result.content, /frame words/u);
  assert.match(result.content, /https:\/\/example\.invalid\/probe\.png/u);
  assert.match(result.content, /\n<\/div>$/u);
  assert.equal(native.notesCreated, 1);
});

test("native note policy parses through a detached HTML document for a XUL-like owner", () => {
  const window = new JSDOM("").window;
  const xulDocument = new window.DOMParser().parseFromString(
    '<window xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"/>',
    "application/xml",
  );
  const policy = new DomPurifyNativeNoteContentPolicy({
    window: windowLikeWithDocument(window, xulDocument),
  });

  assert.equal(
    policy.sanitize('<p>Detached <a href="https://references.example/paper">reference</a></p>'),
    '<p>Detached <a href="https://references.example/paper" rel="noopener noreferrer">reference</a></p>',
  );
  assert.equal(xulDocument.documentElement.childNodes.length, 0);
});

test("native note policy fails closed without a trusted DOM implementation", () => {
  assert.throws(
    () => new DomPurifyNativeNoteContentPolicy({ window: {} }),
    /trusted Zotero DOM window/u,
  );
});

test("native note DOM work stays bounded in an isolated process", () => {
  const moduleUrl = new URL("../../dist/adapters/zotero/index.js", import.meta.url).href;
  const probe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { JSDOM } from "jsdom";
        import { DomPurifyNativeNoteContentPolicy } from ${JSON.stringify(moduleUrl)};
        const policy = new DomPurifyNativeNoteContentPolicy({ window: new JSDOM("").window });
        const nested = "<div>".repeat(6000) + "x" + "</div>".repeat(6000);
        const escape = source => source
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
        const fallback = policy.sanitize(nested);
        if (fallback !== '<pre class="research-companion-note-source">' + escape(nested) + "</pre>") {
          throw new Error("nested source was not preserved exactly");
        }
        if (policy.accepts(nested)) throw new Error("over-depth existing note was accepted");
        if (!policy.accepts(fallback)) throw new Error("bounded fallback is not native-safe");
        if (Buffer.byteLength(fallback, "utf8") > 524288) {
          throw new Error("bounded fallback exceeded the native note byte limit");
        }
        if (policy.accepts("<b>x</b>".repeat(50000))) {
          throw new Error("over-budget existing note was accepted");
        }
        const wideTag = '<span title="' + "x".repeat(70000) + '">complete proof</span>';
        const wideFallback = policy.sanitize(wideTag);
        if (wideFallback !== '<pre class="research-companion-note-source">' + escape(wideTag) + "</pre>") {
          throw new Error("over-budget tag source was not preserved exactly");
        }
        if (!policy.accepts(wideFallback)) throw new Error("wide fallback is not native-safe");
      `,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 4_000 },
  );

  assert.equal(probe.signal, null, probe.error?.message ?? probe.stderr);
  assert.equal(probe.status, 0, probe.stderr);
});

test("child-note creation keeps deeply nested source in a lossless inert fallback", async () => {
  const native = new NativeApiDouble();
  const source = "<div>".repeat(100) + "complete proof" + "</div>".repeat(100);
  const result = await adapter(native).createNote(
    {
      protocolVersion: 1,
      operationId: "op-create-over-budget-note",
      operation: "create_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Save the complete nested source" },
      payload: { libraryId: "1", itemKey: "ITEM0001", content: source },
    },
    {
      operationId: "op-create-over-budget-note",
      requestDigest: "sha256:create-over-budget",
    },
  );

  const document = new JSDOM(result.content).window.document;
  assert.equal(document.querySelector("pre")?.textContent, source);
  assert.equal(native.notesCreated, 1);
});

test("child-note creation preserves malformed source in an inert readable fallback", async () => {
  const native = new NativeApiDouble();
  const result = await adapter(native).createNote(
    {
      protocolVersion: 1,
      operationId: "op-create-malformed-note",
      operation: "create_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Save the complete study text" },
      payload: {
        libraryId: "1",
        itemKey: "ITEM0001",
        content: "Study x<y",
      },
    },
    { operationId: "op-create-malformed-note", requestDigest: "sha256:create-malformed" },
  );

  assert.equal(
    result.content,
    '<pre class="research-companion-note-source">Study x&lt;y</pre>',
  );
  assert.equal(native.notesCreated, 1);
});

test("child-note replacement sanitizes active HTML before native mutation", async () => {
  const native = new NativeApiDouble();
  native.notes.set("NOTE0001", {
    libraryId: "1",
    itemKey: "ITEM0001",
    noteKey: "NOTE0001",
    title: "Existing note",
    content: "<p>Existing body</p>",
    version: 1,
    dateModified: "2026-10-21 10:00:00",
    operationMarkers: [],
  });
  const library = adapter(native);
  const current = await library.readNote({
    protocolVersion: 1,
    operationId: "op-read-note-before-safe-replace",
    operation: "read_note",
    profileId: "profile-A",
    payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
  });
  const result = await library.updateNote(
    {
      protocolVersion: 1,
      operationId: "op-safe-replace-note",
      operation: "update_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Replace NOTE0001 safely" },
      payload: {
        libraryId: "1",
        itemKey: "ITEM0001",
        noteKey: "NOTE0001",
        expectedRevision: current.revision,
        mode: "replace",
        content:
          '<p onclick="steal()">Replacement words</p><object data="https://example.invalid/object">object words</object>',
      },
    },
    { operationId: "op-safe-replace-note", requestDigest: "sha256:safe-replace" },
  );

  assert.doesNotMatch(result.content, /<p[^>]*\sonclick=|<(?:object|script|iframe|img)\b/iu);
  assert.match(result.content, /Replacement words/u);
  assert.match(result.content, /object words/u);
  assert.match(result.content, /https:\/\/example\.invalid\/object/u);
  assert.equal(native.notesUpdated, 1);
});

test("child-note replacement preserves an unfinished tag as inert readable source", async () => {
  const native = new NativeApiDouble();
  native.notes.set("NOTE0001", {
    libraryId: "1",
    itemKey: "ITEM0001",
    noteKey: "NOTE0001",
    title: "Existing note",
    content: "<p>Existing body</p>",
    version: 1,
    dateModified: "2026-10-21 10:00:00",
    operationMarkers: [],
  });
  const library = adapter(native);
  const current = await library.readNote({
    protocolVersion: 1,
    operationId: "op-read-note-before-malformed-replace",
    operation: "read_note",
    profileId: "profile-A",
    payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
  });
  const result = await library.updateNote(
    {
      protocolVersion: 1,
      operationId: "op-malformed-replace-note",
      operation: "update_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Replace NOTE0001 completely" },
      payload: {
        libraryId: "1",
        itemKey: "ITEM0001",
        noteKey: "NOTE0001",
        expectedRevision: current.revision,
        mode: "replace",
        content: "Proof <unfinished",
      },
    },
    {
      operationId: "op-malformed-replace-note",
      requestDigest: "sha256:malformed-replace",
    },
  );

  assert.equal(
    result.content,
    '<pre class="research-companion-note-source">Proof &lt;unfinished</pre>',
  );
  assert.equal(native.notesUpdated, 1);
});

test("child-note append preserves safe existing HTML and sanitizes only added HTML", async () => {
  const native = new NativeApiDouble();
  const existingContent =
    '<p>Manual study words <a href="https://references.example/paper?part=1&amp;view=full">existing reference</a></p><table><tr><td colspan="2">Grouped evidence</td></tr></table><pre class="math">$$x^2$$</pre>';
  native.notes.set("NOTE0001", {
    libraryId: "1",
    itemKey: "ITEM0001",
    noteKey: "NOTE0001",
    title: "Existing note",
    content: existingContent,
    version: 1,
    dateModified: "2026-10-21 10:00:00",
    operationMarkers: [],
  });
  const library = adapter(native);
  const current = await library.readNote({
    protocolVersion: 1,
    operationId: "op-read-note-before-safe-append",
    operation: "read_note",
    profileId: "profile-A",
    payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
  });
  const result = await library.updateNote(
    {
      protocolVersion: 1,
      operationId: "op-safe-append-note",
      operation: "update_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Append safely to NOTE0001" },
      payload: {
        libraryId: "1",
        itemKey: "ITEM0001",
        noteKey: "NOTE0001",
        expectedRevision: current.revision,
        mode: "append",
        content:
          '<p>New approved question <a href="https://new.example/reference?part=2&amp;view=full">web reference</a> <a href="zotero://select/library/items/ITEM0001">library reference</a> <a href="zotero://open-pdf/library/items/ATTACH01?page=1&amp;annotation=ANN00001">PDF reference</a> <a href="javascript:alert(1)">unsafe destination</a> <a href="java&#x73;cript:alert(2)">entity destination</a> <a href="java&#x0A;script:alert(3)">control destination</a> <a href="data:text/html,unsafe">data destination</a> <a href="file:///tmp/private">file destination</a> <a href="zotero://debug/log">unsupported Zotero action</a></p><iframe src="https://example.invalid/new-frame">new frame words</iframe>',
      },
    },
    { operationId: "op-safe-append-note", requestDigest: "sha256:safe-append" },
  );

  assert.doesNotMatch(result.content, /<(?:img|script|iframe)\b/iu);
  assert.ok(result.content.startsWith(`${existingContent}\n\n`));
  assert.match(result.content, /Manual study words/u);
  assert.match(result.content, /<td colspan="2">Grouped evidence<\/td>/u);
  assert.match(result.content, /<pre class="math">\$\$x\^2\$\$<\/pre>/u);
  assert.match(result.content, /New approved question/u);
  assert.match(result.content, /new frame words/u);
  assert.match(
    result.content,
    /<a href="https:\/\/references\.example\/paper\?part=1&amp;view=full">existing reference<\/a>/u,
  );
  assert.match(
    result.content,
    /<a href="https:\/\/new\.example\/reference\?part=2&amp;view=full" rel="noopener noreferrer">web reference<\/a>/u,
  );
  assert.match(
    result.content,
    /<a href="zotero:\/\/select\/library\/items\/ITEM0001">library reference<\/a>/u,
  );
  assert.match(
    result.content,
    /<a href="zotero:\/\/open-pdf\/library\/items\/ATTACH01\?page=1&amp;annotation=ANN00001">PDF reference<\/a>/u,
  );
  assert.doesNotMatch(
    result.content,
    /<[A-Za-z][^>]*\s(?:on[A-Za-z]+|href=["'](?:javascript|data|file):)/iu,
  );
  assert.doesNotMatch(result.content, /<a href="zotero:\/\/debug/iu);
  assert.match(result.content, /javascript:alert\(1\)/u);
  assert.match(result.content, /unsafe destination/u);
  assert.match(result.content, /entity destination/u);
  assert.match(result.content, /control destination/u);
  assert.match(result.content, /data destination/u);
  assert.match(result.content, /file destination/u);
  assert.match(result.content, /unsupported Zotero action/u);
  assert.equal(native.notesUpdated, 1);
});

test("child-note append preserves duplicate-link source without activating either destination", async () => {
  const native = new NativeApiDouble();
  const existingContent = '<p><a href="https://references.example/original">Original reference</a></p>';
  native.notes.set("NOTE0001", {
    libraryId: "1",
    itemKey: "ITEM0001",
    noteKey: "NOTE0001",
    title: "Existing note",
    content: existingContent,
    version: 1,
    dateModified: "2026-10-21 10:00:00",
    operationMarkers: [],
  });
  const library = adapter(native);
  const current = await library.readNote({
    protocolVersion: 1,
    operationId: "op-read-before-ambiguous-addition",
    operation: "read_note",
    profileId: "profile-A",
    payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
  });
  const addition =
    '<a href="https://references.example/safe" href="javascript:alert(1)">Ambiguous reference</a>';
  const result = await library.updateNote(
    {
      protocolVersion: 1,
      operationId: "op-append-ambiguous-addition",
      operation: "update_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Append source to NOTE0001" },
      payload: {
        libraryId: "1",
        itemKey: "ITEM0001",
        noteKey: "NOTE0001",
        expectedRevision: current.revision,
        mode: "append",
        content: addition,
      },
    },
    {
      operationId: "op-append-ambiguous-addition",
      requestDigest: "sha256:append-ambiguous-addition",
    },
  );

  assert.ok(result.content.startsWith(`${existingContent}\n\n`));
  assert.match(result.content, /https:\/\/references\.example\/safe/u);
  assert.match(result.content, /javascript:alert\(1\)/u);
  assert.match(result.content, /Ambiguous reference/u);
  assert.doesNotMatch(result.content.slice(existingContent.length), /<a\b/iu);
  assert.equal(native.notesUpdated, 1);
});

test("child-note append rejects incompatible existing active HTML without mutation", async () => {
  const native = new NativeApiDouble();
  const existingContent =
    '<p>Manual study words</p><img src="https://example.invalid/existing.png" alt="existing diagram">';
  native.notes.set("NOTE0001", {
    libraryId: "1",
    itemKey: "ITEM0001",
    noteKey: "NOTE0001",
    title: "Existing note",
    content: existingContent,
    version: 1,
    dateModified: "2026-10-21 10:00:00",
    operationMarkers: [],
  });
  const library = adapter(native);
  const current = await library.readNote({
    protocolVersion: 1,
    operationId: "op-read-incompatible-note",
    operation: "read_note",
    profileId: "profile-A",
    payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
  });

  await assert.rejects(
    () =>
      library.updateNote(
        {
          protocolVersion: 1,
          operationId: "op-append-incompatible-note",
          operation: "update_note",
          profileId: "profile-A",
          authorization: { kind: "explicit_request", scope: "Append to NOTE0001" },
          payload: {
            libraryId: "1",
            itemKey: "ITEM0001",
            noteKey: "NOTE0001",
            expectedRevision: current.revision,
            mode: "append",
            content: "<p>Approved addition</p>",
          },
        },
        {
          operationId: "op-append-incompatible-note",
          requestDigest: "sha256:append-incompatible",
        },
      ),
    (error) => error instanceof CoreOperationError && error.code === "unsupported_capability",
  );
  assert.equal(native.notesUpdated, 0);
  assert.equal(native.notes.get("NOTE0001").content, existingContent);
  assert.deepEqual(native.notes.get("NOTE0001").operationMarkers, []);
});

test("child-note append rejects unsafe existing link schemes including obfuscation", async () => {
  const cases = [
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,unsafe"],
    ["file", "file:///tmp/private"],
    ["entity", "java&colon;script:alert(2)"],
    ["control", "java&#x0A;script:alert(3)"],
    ["zotero-action", "zotero://debug/log"],
  ];
  for (const [label, href] of cases) {
    const native = new NativeApiDouble();
    const existingContent = `<p>Manual reference <a href="${href}">${label}</a></p>`;
    native.notes.set("NOTE0001", {
      libraryId: "1",
      itemKey: "ITEM0001",
      noteKey: "NOTE0001",
      title: "Existing note",
      content: existingContent,
      version: 1,
      dateModified: "2026-10-21 10:00:00",
      operationMarkers: [],
    });
    const library = adapter(native);
    const current = await library.readNote({
      protocolVersion: 1,
      operationId: `op-read-unsafe-link-${label}`,
      operation: "read_note",
      profileId: "profile-A",
      payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
    });

    await assert.rejects(
      () =>
        library.updateNote(
          {
            protocolVersion: 1,
            operationId: `op-append-unsafe-link-${label}`,
            operation: "update_note",
            profileId: "profile-A",
            authorization: { kind: "explicit_request", scope: "Append to NOTE0001" },
            payload: {
              libraryId: "1",
              itemKey: "ITEM0001",
              noteKey: "NOTE0001",
              expectedRevision: current.revision,
              mode: "append",
              content: "<p>Approved addition</p>",
            },
          },
          {
            operationId: `op-append-unsafe-link-${label}`,
            requestDigest: `sha256:append-unsafe-link-${label}`,
          },
        ),
      (error) => error instanceof CoreOperationError && error.code === "unsupported_capability",
      label,
    );
    assert.equal(native.notesUpdated, 0, label);
    assert.equal(native.notes.get("NOTE0001").content, existingContent, label);
    assert.deepEqual(native.notes.get("NOTE0001").operationMarkers, [], label);
  }
});

test("child-note append rejects duplicate or malformed existing attributes", async () => {
  const cases = [
    [
      "duplicate",
      '<p><a href="https://references.example/safe" href="javascript:alert(1)">ambiguous link</a></p>',
    ],
    ["malformed", '<p><a href="https://references.example/unterminated>ambiguous link</a></p>'],
  ];
  for (const [label, existingContent] of cases) {
    const native = new NativeApiDouble();
    native.notes.set("NOTE0001", {
      libraryId: "1",
      itemKey: "ITEM0001",
      noteKey: "NOTE0001",
      title: "Existing note",
      content: existingContent,
      version: 1,
      dateModified: "2026-10-21 10:00:00",
      operationMarkers: [],
    });
    const library = adapter(native);
    const current = await library.readNote({
      protocolVersion: 1,
      operationId: `op-read-ambiguous-attribute-${label}`,
      operation: "read_note",
      profileId: "profile-A",
      payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
    });

    await assert.rejects(
      () =>
        library.updateNote(
          {
            protocolVersion: 1,
            operationId: `op-append-ambiguous-attribute-${label}`,
            operation: "update_note",
            profileId: "profile-A",
            authorization: { kind: "explicit_request", scope: "Append to NOTE0001" },
            payload: {
              libraryId: "1",
              itemKey: "ITEM0001",
              noteKey: "NOTE0001",
              expectedRevision: current.revision,
              mode: "append",
              content: "<p>Approved addition</p>",
            },
          },
          {
            operationId: `op-append-ambiguous-attribute-${label}`,
            requestDigest: `sha256:append-ambiguous-attribute-${label}`,
          },
        ),
      (error) => error instanceof CoreOperationError && error.code === "unsupported_capability",
      label,
    );
    assert.equal(native.notesUpdated, 0, label);
    assert.equal(native.notes.get("NOTE0001").content, existingContent, label);
    assert.deepEqual(native.notes.get("NOTE0001").operationMarkers, [], label);
  }
});

test("child-note append rejects an over-budget existing DOM before mutation", async () => {
  const native = new NativeApiDouble();
  const existingContent = "<b>x</b>".repeat(3_000);
  native.notes.set("NOTE0001", {
    libraryId: "1",
    itemKey: "ITEM0001",
    noteKey: "NOTE0001",
    title: "Existing note",
    content: existingContent,
    version: 1,
    dateModified: "2026-10-21 10:00:00",
    operationMarkers: [],
  });
  const library = adapter(native);
  const current = await library.readNote({
    protocolVersion: 1,
    operationId: "op-read-over-budget-note",
    operation: "read_note",
    profileId: "profile-A",
    payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
  });

  await assert.rejects(
    () =>
      library.updateNote(
        {
          protocolVersion: 1,
          operationId: "op-append-over-budget-note",
          operation: "update_note",
          profileId: "profile-A",
          authorization: { kind: "explicit_request", scope: "Append to NOTE0001" },
          payload: {
            libraryId: "1",
            itemKey: "ITEM0001",
            noteKey: "NOTE0001",
            expectedRevision: current.revision,
            mode: "append",
            content: "<p>Approved addition</p>",
          },
        },
        {
          operationId: "op-append-over-budget-note",
          requestDigest: "sha256:append-over-budget-note",
        },
      ),
    (error) => error instanceof CoreOperationError && error.code === "unsupported_capability",
  );
  assert.equal(native.notesUpdated, 0);
  assert.equal(native.notes.get("NOTE0001").content, existingContent);
  assert.deepEqual(native.notes.get("NOTE0001").operationMarkers, []);
});

test("child-note append enforces the final UTF-8 limit before the native writer", async () => {
  const makeNative = (content) => {
    const native = new NativeApiDouble();
    native.notes.set("NOTE0001", {
      libraryId: "1",
      itemKey: "ITEM0001",
      noteKey: "NOTE0001",
      title: "Existing note",
      content,
      version: 1,
      dateModified: "2026-10-21 10:00:00",
      operationMarkers: [],
    });
    return native;
  };
  const append = async (library, operationId) => {
    const current = await library.readNote({
      protocolVersion: 1,
      operationId: `${operationId}-read`,
      operation: "read_note",
      profileId: "profile-A",
      payload: { libraryId: "1", itemKey: "ITEM0001", noteKey: "NOTE0001" },
    });
    return library.updateNote(
      {
        protocolVersion: 1,
        operationId,
        operation: "update_note",
        profileId: "profile-A",
        authorization: { kind: "explicit_request", scope: "Append at the byte boundary" },
        payload: {
          libraryId: "1",
          itemKey: "ITEM0001",
          noteKey: "NOTE0001",
          expectedRevision: current.revision,
          mode: "append",
          content: "가",
        },
      },
      { operationId, requestDigest: `sha256:${operationId}` },
    );
  };

  const allowedNative = makeNative("a".repeat(MAX_TEXT_BYTES - 5));
  const allowed = await append(adapter(allowedNative), "op-note-boundary-allowed");
  assert.equal(new TextEncoder().encode(allowed.content).byteLength, MAX_TEXT_BYTES);
  assert.equal(allowedNative.notesUpdated, 1);

  const overflowingNative = makeNative("a".repeat(MAX_TEXT_BYTES - 4));
  await assert.rejects(
    () => append(adapter(overflowingNative), "op-note-boundary-overflow"),
    (error) => error instanceof CoreOperationError && error.code === "too_large",
  );
  assert.equal(overflowingNative.notesUpdated, 0);
});
