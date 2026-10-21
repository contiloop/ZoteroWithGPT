import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreOperationError,
  OperationCoordinator,
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
