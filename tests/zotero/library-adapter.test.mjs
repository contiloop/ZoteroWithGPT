import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CoreOperationError } from "../../dist/core/index.js";
import {
  ZoteroLibraryAdapter,
  ZoteroOperationRecovery,
  operationIdentityMarker,
} from "../../dist/adapters/zotero/index.js";

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

function updateAnnotationRequest(revision, mode = "append") {
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
      comment: "Added by the researcher",
    },
  };
}

class NativeApiDouble {
  fingerprint = "sha256:pdf-a";
  created = 0;
  updated = 0;
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
    const wrapper = input.content.match(
      /^<div class="zotero-note znv[0-9]+">([\s\S]*)<\/div>$/u,
    );
    const record = {
      libraryId: input.libraryId,
      itemKey: input.itemKey,
      noteKey: "NOTE0001",
      title: "Requested note",
      content: wrapper ? wrapper[1] : input.content,
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
    const wrapper = input.content.match(
      /^<div class="zotero-note znv[0-9]+">([\s\S]*)<\/div>$/u,
    );
    const record = {
      ...current,
      content: wrapper ? wrapper[1] : input.content,
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
  return new ZoteroLibraryAdapter({
    native,
    digest: new Sha256Digest(),
    profileId: "profile-A",
    pluginVersion: "0.1.0",
    enabled: true,
    transport: { kind: "custom", description: "Test transport" },
  });
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
