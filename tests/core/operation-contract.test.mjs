import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreOperationError,
  OperationCoordinator,
  assertExpectedRevision,
  assertMutationAuthorizedForProfile,
  revalidateAnnotationAnchor,
  transitionOperationState,
} from "../../dist/core/index.js";
import {
  canonicalRequestBytes,
  canonicalizeJson,
  validateProtocolRequest,
} from "../../dist/protocol/index.js";

const encoder = new TextEncoder();

class StableDigest {
  calls = 0;

  async digest(bytes) {
    this.calls += 1;
    // Test double only: identity semantics are under test, not cryptographic strength.
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return `test:${(hash >>> 0).toString(16)}`;
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
    const value = this.records.get(operationId);
    return value ? structuredClone(value) : undefined;
  }

  async transition(operationId, from, next) {
    const current = this.records.get(operationId);
    if (!current || current.state !== from) throw new Error("optimistic transition failed");
    this.records.set(operationId, structuredClone(next));
    return structuredClone(next);
  }
}

class InlineMutationSerializer {
  calls = [];

  async runExclusive(profileId, work) {
    this.calls.push(profileId);
    return work();
  }
}

class RevisionedNotePortDouble {
  note = {
    parentItemKey: "ITEM1234",
    noteKey: "NOTE1234",
    revision: "rev:1",
    content: "Human-authored summary.",
    deepLink: "zotero://select/library/items/NOTE1234",
  };
  revisionNumber = 1;
  updateAttempts = 0;
  successfulWrites = 0;

  async readNote(request) {
    assert.equal(request.payload.noteKey, this.note.noteKey);
    return structuredClone(this.note);
  }

  manualAppend(content) {
    this.revisionNumber += 1;
    this.note = {
      ...this.note,
      revision: `rev:${this.revisionNumber}`,
      content: `${this.note.content}\n\n${content}`,
    };
  }

  async updateNote(request) {
    this.updateAttempts += 1;
    assertExpectedRevision(request.payload.expectedRevision, this.note.revision);
    const content =
      request.payload.mode === "append"
        ? `${this.note.content}\n\n${request.payload.content}`
        : request.payload.content;
    this.revisionNumber += 1;
    this.successfulWrites += 1;
    this.note = {
      ...this.note,
      revision: `rev:${this.revisionNumber}`,
      content,
    };
    return {
      noteKey: this.note.noteKey,
      revision: this.note.revision,
      content: this.note.content,
      deepLink: this.note.deepLink,
    };
  }

  async confirmNote(target) {
    return {
      confirmed:
        target.noteKey === this.note.noteKey && target.expectedRevision === this.note.revision,
      description: "In-memory readback of the revisioned note test double.",
    };
  }
}

const anchor = {
  libraryId: "1",
  itemKey: "ITEM1234",
  attachmentKey: "ATTACH01",
  attachmentFingerprint: "sha256:pdf-revision-a",
  pageIndex: 2,
  pageLabel: "3",
  rectangles: [{ x1: 12, y1: 30, x2: 140, y2: 45 }],
  selectedText: "posterior concentration",
  matchEvidence: {
    method: "exact_quote",
    matchedText: "posterior concentration",
    exact: true,
  },
};

function annotationRequest(overrides = {}) {
  return validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.create-1",
    operation: "create_annotation",
    profileId: "profile-A",
    authorization: {
      kind: "explicit_request",
      scope: "Save the proof on the selected passage in ATTACH01.",
    },
    payload: { anchor, type: "highlight", comment: "Proof", ...overrides },
  });
}

test("canonical JSON and request bytes do not depend on object key insertion order", () => {
  assert.equal(
    canonicalizeJson({ z: 1, a: { y: [3, 2, 1], x: true } }),
    canonicalizeJson({ a: { x: true, y: [3, 2, 1] }, z: 1 }),
  );

  const first = annotationRequest();
  const second = validateProtocolRequest({
    payload: { comment: "Proof", type: "highlight", anchor },
    authorization: {
      scope: "Save the proof on the selected passage in ATTACH01.",
      kind: "explicit_request",
    },
    profileId: "profile-A",
    operation: "create_annotation",
    operationId: "op.create-1",
    protocolVersion: 1,
  });
  assert.deepEqual(canonicalRequestBytes(first), canonicalRequestBytes(second));
});

test("canonicalizer rejects values outside the JSON data model", () => {
  assert.throws(() => canonicalizeJson({ unsafe: undefined }), /canonical JSON/i);
  assert.throws(() => canonicalizeJson({ unsafe: Number.NaN }), /canonical JSON/i);
  assert.deepEqual(encoder.encode(canonicalizeJson({ a: 1 })), encoder.encode('{"a":1}'));
});

test("lifecycle only permits queued to running to a terminal state, plus early rejection", () => {
  assert.equal(transitionOperationState("queued", "running"), "running");
  assert.equal(transitionOperationState("queued", "rejected"), "rejected");
  assert.equal(transitionOperationState("running", "succeeded"), "succeeded");
  assert.equal(transitionOperationState("running", "failed"), "failed");
  assert.equal(transitionOperationState("running", "indeterminate"), "indeterminate");
  assert.throws(() => transitionOperationState("queued", "succeeded"), /transition/i);
  assert.throws(() => transitionOperationState("succeeded", "running"), /transition/i);
});

test("authorization is scoped to the connected profile", () => {
  const request = annotationRequest();
  assert.doesNotThrow(() => assertMutationAuthorizedForProfile(request, "profile-A"));
  assert.throws(
    () => assertMutationAuthorizedForProfile(request, "profile-B"),
    (error) => error instanceof CoreOperationError && error.code === "permission_denied",
  );
  assert.throws(
    () => assertMutationAuthorizedForProfile(request, undefined),
    (error) => error instanceof CoreOperationError && error.code === "not_connected",
  );
});

test("annotation anchors must be revalidated; unresolved geometry is never guessed", async () => {
  const result = await revalidateAnnotationAnchor(annotationRequest(), {
    async revalidate() {
      return { status: "unresolved", reason: "Quote occurs twice on the page." };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unresolved_anchor");
});

test("same operation ID and payload is replayed without executing twice", async () => {
  const store = new MemoryOperationStore();
  const digest = new StableDigest();
  const serializer = new InlineMutationSerializer();
  let executions = 0;
  const coordinator = new OperationCoordinator({ store, digest, serializer });
  const request = annotationRequest();
  const execute = async () => {
    executions += 1;
    return {
      kind: "completed",
      data: {
        annotationKey: "ANN00001",
        revision: "rev:1",
        deepLink: "zotero://open-pdf/library/items/ATTACH01?page=3&annotation=ANN00001",
        saved: {
          pageIndex: 2,
          pageLabel: "3",
          rectangles: anchor.rectangles,
          selectedText: anchor.selectedText,
          comment: "Proof",
        },
      },
      verification: { storage: "confirmed", viewer: "confirmed" },
    };
  };

  const first = await coordinator.submit(request, "profile-A", execute);
  const replay = await coordinator.submit(request, "profile-A", execute);

  assert.equal(first.state, "succeeded");
  assert.deepEqual(replay, first);
  assert.equal(executions, 1);
  assert.deepEqual(serializer.calls, ["profile-A"]);
});

test("offline local arXiv lookup remains a replayable read outside mutation serialization", async () => {
  const store = new MemoryOperationStore();
  const serializer = new InlineMutationSerializer();
  const coordinator = new OperationCoordinator({
    store,
    digest: new StableDigest(),
    serializer,
  });
  const request = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.find-local-core-1",
    operation: "find_local_arxiv",
    profileId: "profile-A",
    payload: { url: "https://arxiv.org/abs/2401.01234v2", limit: 25 },
  });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return {
      kind: "completed",
      data: {
        source: { arxivId: "2401.01234", version: 2 },
        matches: [],
        truncated: false,
      },
      verification: { storage: "not_applicable", viewer: "not_applicable" },
    };
  };

  const first = await coordinator.submit(request, "profile-A", execute);
  const replay = await coordinator.submit(request, "profile-A", execute);

  assert.equal(first.state, "succeeded");
  assert.deepEqual(replay, first);
  assert.equal(executions, 1);
  assert.deepEqual(serializer.calls, []);
});

test("submit snapshots request content before the digest await", async () => {
  const store = new MemoryOperationStore();
  const coordinator = new OperationCoordinator({
    store,
    digest: new StableDigest(),
    serializer: new InlineMutationSerializer(),
  });
  const mutableRequest = annotationRequest();
  let executorComment;
  let executorRequestFrozen;

  const pending = coordinator.submit(mutableRequest, "profile-A", async (acceptedRequest) => {
    executorComment = acceptedRequest.payload.comment;
    executorRequestFrozen = Object.isFrozen(acceptedRequest.payload);
    return {
      kind: "completed",
      data: {
        annotationKey: "ANN00001",
        revision: "rev:1",
        deepLink: "zotero://saved-snapshot",
        saved: { comment: acceptedRequest.payload.comment },
      },
      verification: { storage: "confirmed", viewer: "not_checked" },
    };
  });

  mutableRequest.payload.comment = "Content changed while digesting";
  const first = await pending;
  const replay = await coordinator.submit(annotationRequest(), "profile-A", async () => {
    throw new Error("canonical replay must not execute again");
  });

  assert.equal(executorComment, "Proof");
  assert.equal(executorRequestFrozen, true);
  assert.equal(first.data.saved.comment, "Proof");
  assert.deepEqual(replay, first);
});

test("same operation ID with a different canonical request is rejected", async () => {
  const coordinator = new OperationCoordinator({
    store: new MemoryOperationStore(),
    digest: new StableDigest(),
    serializer: new InlineMutationSerializer(),
  });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return {
      kind: "completed",
      data: { annotationKey: "A", revision: "r", deepLink: "zotero://x", saved: {} },
      verification: { storage: "confirmed", viewer: "not_checked" },
    };
  };

  await coordinator.submit(annotationRequest(), "profile-A", execute);
  const mismatch = await coordinator.submit(
    annotationRequest({ comment: "Different proof" }),
    "profile-A",
    execute,
  );

  assert.equal(mismatch.state, "rejected");
  assert.equal(mismatch.error.code, "duplicate_id_mismatch");
  assert.equal(executions, 1);
});

test("storage readback controls mutation success independently from viewer evidence", async () => {
  const submit = async (operationId, verification) => {
    const coordinator = new OperationCoordinator({
      store: new MemoryOperationStore(),
      digest: new StableDigest(),
      serializer: new InlineMutationSerializer(),
    });
    const request = validateProtocolRequest({
      ...annotationRequest(),
      operationId,
    });
    return coordinator.submit(request, "profile-A", async () => ({
      kind: "completed",
      data: { annotationKey: "A", revision: "r", deepLink: "zotero://x", saved: {} },
      verification,
    }));
  };

  const viewerFailure = await submit("op.viewer-failed", {
    storage: "confirmed",
    viewer: "failed",
  });
  assert.equal(viewerFailure.state, "succeeded");
  assert.equal(viewerFailure.error, null);
  assert.equal(viewerFailure.verification.viewer, "failed");

  const readbackFailure = await submit("op.readback-failed", {
    storage: "failed",
    viewer: "not_checked",
  });
  assert.equal(readbackFailure.state, "failed");
  assert.equal(readbackFailure.error.code, "verification_failed");

  const uncertainReadback = await submit("op.readback-unknown", {
    storage: "not_checked",
    viewer: "not_checked",
  });
  assert.equal(uncertainReadback.state, "indeterminate");
  assert.equal(uncertainReadback.error.code, "unknown_outcome");
});

test("executor exceptions on mutations become indeterminate and are not blindly retried", async () => {
  const store = new MemoryOperationStore();
  const coordinator = new OperationCoordinator({
    store,
    digest: new StableDigest(),
    serializer: new InlineMutationSerializer(),
  });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    throw new Error("transport disappeared after native call");
  };

  const first = await coordinator.submit(annotationRequest(), "profile-A", execute);
  const replay = await coordinator.submit(annotationRequest(), "profile-A", execute);

  assert.equal(first.state, "indeterminate");
  assert.equal(first.error.code, "unknown_outcome");
  assert.deepEqual(replay, first);
  assert.equal(executions, 1);
});

test("crash-left running mutations reconcile by identity without invoking a writer", async () => {
  const store = new MemoryOperationStore();
  const digest = new StableDigest();
  const serializer = new InlineMutationSerializer();
  const coordinator = new OperationCoordinator({ store, digest, serializer });
  const request = validateProtocolRequest({
    ...annotationRequest(),
    operationId: "op.crash-left",
  });
  const requestDigest = await digest.digest(canonicalRequestBytes(request));
  await store.claim({
    protocolVersion: 1,
    operationId: request.operationId,
    requestDigest,
    operation: request.operation,
    profileId: request.profileId,
    mutation: true,
    state: "running",
    response: {
      protocolVersion: 1,
      operationId: request.operationId,
      state: "running",
      data: null,
      error: null,
      verification: { storage: "not_checked", viewer: "not_checked" },
    },
  });

  let reconciliations = 0;
  const recovered = await coordinator.reconcileRunning(
    request.operationId,
    "profile-A",
    {
      async reconcile(record) {
        reconciliations += 1;
        assert.equal(record.requestDigest, requestDigest);
        return {
          kind: "completed",
          data: {
            annotationKey: "ANN00001",
            revision: "rev:1",
            deepLink: "zotero://recovered",
            saved: {},
          },
          verification: { storage: "confirmed", viewer: "failed" },
        };
      },
    },
  );
  assert.equal(recovered.state, "succeeded");
  assert.equal(reconciliations, 1);
  assert.equal((await coordinator.get(request.operationId)).state, "succeeded");

  let writerCalls = 0;
  const replay = await coordinator.submit(request, "profile-A", async () => {
    writerCalls += 1;
    throw new Error("historical mutation must not execute");
  });
  assert.equal(replay.state, "succeeded");
  assert.equal(writerCalls, 0);
});

test("note conflict preserves human content and requires re-read, revision, and new approval", async () => {
  const notePort = new RevisionedNotePortDouble();
  const coordinator = new OperationCoordinator({
    store: new MemoryOperationStore(),
    digest: new StableDigest(),
    serializer: new InlineMutationSerializer(),
  });
  const readRequest = (operationId) =>
    validateProtocolRequest({
      protocolVersion: 1,
      operationId,
      operation: "read_note",
      profileId: "profile-A",
      payload: { libraryId: "1", itemKey: "ITEM1234", noteKey: "NOTE1234" },
    });
  const executeRead = async (request) => ({
    kind: "completed",
    data: await notePort.readNote(request),
    verification: { storage: "not_applicable", viewer: "not_applicable" },
  });
  const executeUpdate = async (request, identity) => {
    try {
      const data = await notePort.updateNote(request, identity);
      const readback = await notePort.confirmNote({
        libraryId: request.payload.libraryId,
        itemKey: request.payload.itemKey,
        noteKey: data.noteKey,
        expectedRevision: data.revision,
      });
      return {
        kind: "completed",
        data,
        verification: {
          storage: readback.confirmed ? "confirmed" : "failed",
          viewer: "not_applicable",
        },
      };
    } catch (error) {
      if (!(error instanceof CoreOperationError)) throw error;
      return {
        kind: "failed",
        error: error.toProtocolError(),
        verification: { storage: "not_checked", viewer: "not_applicable" },
      };
    }
  };

  const initialRead = await coordinator.submit(
    readRequest("op.note-initial-read"),
    "profile-A",
    executeRead,
  );
  assert.equal(initialRead.state, "succeeded");
  assert.equal(initialRead.data.revision, "rev:1");
  assert.equal(initialRead.data.content, "Human-authored summary.");

  const staleAuthorization = {
    kind: "explicit_request",
    scope: "Append the study question to NOTE1234 as read at rev:1.",
  };
  const staleUpdate = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.note-stale-update",
    operation: "update_note",
    profileId: "profile-A",
    authorization: staleAuthorization,
    payload: {
      libraryId: "1",
      itemKey: "ITEM1234",
      noteKey: "NOTE1234",
      expectedRevision: initialRead.data.revision,
      mode: "append",
      content: "Question: Does the result survive a heavy-tailed prior?",
    },
  });

  notePort.manualAppend("Manual correction added by the researcher.");
  const contentAfterManualEdit = notePort.note.content;
  const conflict = await coordinator.submit(staleUpdate, "profile-A", executeUpdate);
  assert.equal(conflict.state, "failed");
  assert.equal(conflict.error.code, "conflict");
  assert.equal(notePort.note.content, contentAfterManualEdit);
  assert.equal(notePort.successfulWrites, 0);

  const conflictReplay = await coordinator.submit(staleUpdate, "profile-A", executeUpdate);
  assert.deepEqual(conflictReplay, conflict);
  assert.equal(notePort.updateAttempts, 1);

  const freshRead = await coordinator.submit(
    readRequest("op.note-read-after-conflict"),
    "profile-A",
    executeRead,
  );
  assert.equal(freshRead.data.revision, "rev:2");
  assert.equal(freshRead.data.content, contentAfterManualEdit);

  const renewedAuthorization = {
    kind: "explicit_request",
    scope:
      "After re-reading NOTE1234 at rev:2, preserve its manual correction and append the approved study question.",
  };
  assert.notEqual(renewedAuthorization.scope, staleAuthorization.scope);
  const approvedQuestion = "Question: Does the result survive a heavy-tailed prior?";
  const freshUpdate = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.note-approved-update",
    operation: "update_note",
    profileId: "profile-A",
    authorization: renewedAuthorization,
    payload: {
      libraryId: "1",
      itemKey: "ITEM1234",
      noteKey: "NOTE1234",
      expectedRevision: freshRead.data.revision,
      mode: "append",
      content: approvedQuestion,
    },
  });
  const updated = await coordinator.submit(freshUpdate, "profile-A", executeUpdate);
  assert.equal(updated.state, "succeeded");
  assert.equal(updated.verification.storage, "confirmed");
  assert.equal(updated.data.revision, "rev:3");
  assert.equal(updated.data.content, `${contentAfterManualEdit}\n\n${approvedQuestion}`);
  assert.equal(notePort.successfulWrites, 1);

  const finalRead = await coordinator.submit(
    readRequest("op.note-final-read"),
    "profile-A",
    executeRead,
  );
  assert.equal(finalRead.data.revision, "rev:3");
  assert.equal(finalRead.data.content, updated.data.content);
});

function ensureArxivRequest(operationId = "op.ensure-core-1") {
  return validateProtocolRequest({
    protocolVersion: 1,
    operationId,
    operation: "ensure_arxiv_pdf",
    profileId: "profile-A",
    authorization: {
      kind: "explicit_request",
      scope: "Create the inspected arXiv parent and retain it if PDF acquisition fails.",
    },
    payload: {
      source: { arxivId: "2401.01234", version: 2 },
      inspectionToken: "inspection:2401.01234:v2:snapshot-1",
      selection: { kind: "create" },
    },
  });
}

const retainedArxivItem = {
  source: { arxivId: "2401.01234", version: 2 },
  libraryId: "1",
  completion: "item_only",
  itemKey: "ITEM1234",
  itemAction: "created",
  attachmentKey: null,
  attachmentFingerprint: null,
  pdfAction: "none",
  deepLink: "zotero://select/library/items/ITEM1234",
};

test("ensure_arxiv_pdf retains only a confirmed item-only storage failure", async () => {
  const coordinator = new OperationCoordinator({
    store: new MemoryOperationStore(),
    digest: new StableDigest(),
    serializer: new InlineMutationSerializer(),
  });
  const response = await coordinator.submit(
    ensureArxivRequest(),
    "profile-A",
    async () => ({
      kind: "failed",
      data: retainedArxivItem,
      error: {
        code: "storage_error",
        message: "The parent item was confirmed, but PDF acquisition failed.",
        retryable: false,
      },
      verification: { storage: "confirmed", viewer: "not_checked" },
    }),
  );

  assert.equal(response.state, "failed");
  assert.deepEqual(response.data, retainedArxivItem);
  assert.equal(response.error.code, "storage_error");
});

test("failed outcomes cannot propagate arbitrary or malformed retained data", async () => {
  const submit = async (request, data) => {
    const coordinator = new OperationCoordinator({
      store: new MemoryOperationStore(),
      digest: new StableDigest(),
      serializer: new InlineMutationSerializer(),
    });
    return coordinator.submit(request, "profile-A", async () => ({
      kind: "failed",
      data,
      error: { code: "storage_error", message: "Write failed.", retryable: false },
      verification: { storage: "confirmed", viewer: "not_checked" },
    }));
  };

  const ordinaryMutation = await submit(
    validateProtocolRequest({
      protocolVersion: 1,
      operationId: "op.no-arbitrary-data",
      operation: "create_note",
      profileId: "profile-A",
      authorization: { kind: "explicit_request", scope: "Create the requested note." },
      payload: { libraryId: "1", itemKey: "ITEM1234", content: "Study note" },
    }),
    { noteKey: "FAKE" },
  );
  assert.equal(ordinaryMutation.state, "failed");
  assert.equal(ordinaryMutation.data, null);

  const malformedEnsure = await submit(
    ensureArxivRequest("op.malformed-retained-data"),
    { ...retainedArxivItem, attachmentKey: "ATTACH01" },
  );
  assert.equal(malformedEnsure.state, "failed");
  assert.equal(malformedEnsure.data, null);
});

test("ensure_arxiv_pdf succeeds only with ready data, confirmed storage, and unchecked viewer", async () => {
  const submit = async (
    operationId,
    data,
    verification = { storage: "confirmed", viewer: "not_checked" },
  ) => {
    const coordinator = new OperationCoordinator({
      store: new MemoryOperationStore(),
      digest: new StableDigest(),
      serializer: new InlineMutationSerializer(),
    });
    return coordinator.submit(ensureArxivRequest(operationId), "profile-A", async () => ({
      kind: "completed",
      data,
      verification,
    }));
  };
  const ready = {
    ...retainedArxivItem,
    completion: "ready",
    attachmentKey: "ATTACH01",
    attachmentFingerprint: "sha256:known-pdf",
    pdfAction: "downloaded",
    deepLink: "zotero://open-pdf/library/items/ATTACH01",
  };
  const succeeded = await submit("op.ensure-ready", ready);
  assert.equal(succeeded.state, "succeeded");
  assert.deepEqual(succeeded.data, ready);

  const invalid = await submit("op.ensure-invalid-completion", retainedArxivItem);
  assert.equal(invalid.state, "indeterminate");
  assert.equal(invalid.data, null);
  assert.equal(invalid.error.code, "unknown_outcome");

  for (const viewer of ["confirmed", "failed", "not_applicable"]) {
    const mismatchedEvidence = await submit(
      `op.ensure-invalid-viewer-${viewer}`,
      ready,
      { storage: "confirmed", viewer },
    );
    assert.equal(mismatchedEvidence.state, "indeterminate");
    assert.equal(mismatchedEvidence.data, null);
    assert.equal(mismatchedEvidence.error.code, "unknown_outcome");
  }
});

test("old protocol requests and 0.1.0-shaped historical journal responses remain readable", async () => {
  const oldRequest = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.legacy-read-1",
    operation: "search_papers",
    profileId: "profile-A",
    payload: { query: "Bayesian inference", limit: 25 },
  });
  assert.equal(oldRequest.operation, "search_papers");

  const store = new MemoryOperationStore();
  const historical = {
    protocolVersion: 1,
    operationId: "op.legacy-journal-1",
    requestDigest: "sha256:legacy-0.1.0",
    operation: "create_note",
    profileId: "profile-A",
    mutation: true,
    state: "succeeded",
    response: {
      protocolVersion: 1,
      operationId: "op.legacy-journal-1",
      state: "succeeded",
      data: {
        noteKey: "NOTE1234",
        revision: "rev:1",
        content: "Historical note",
        deepLink: "zotero://select/library/items/NOTE1234",
      },
      error: null,
      verification: { storage: "confirmed", viewer: "not_applicable" },
    },
  };
  store.records.set(historical.operationId, structuredClone(historical));
  const coordinator = new OperationCoordinator({
    store,
    digest: new StableDigest(),
    serializer: new InlineMutationSerializer(),
  });
  assert.deepEqual(await coordinator.get(historical.operationId), historical.response);
});
