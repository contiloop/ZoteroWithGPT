import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  DurableOperationStore,
  IOUtilsAtomicTextFile,
  KeyedMutationSerializer,
} from "../../dist/adapters/operation-store/index.js";
import { OperationCoordinator } from "../../dist/core/index.js";
import { validateProtocolRequest } from "../../dist/protocol/index.js";

class MemoryAtomicFile {
  text;
  writes = 0;

  async readText() {
    return this.text;
  }

  async writeTextAtomic(text) {
    this.text = text;
    this.writes += 1;
  }
}

function record(operationId = "op-1", requestDigest = "sha256:payload-a") {
  return {
    protocolVersion: 1,
    operationId,
    requestDigest,
    operation: "create_annotation",
    profileId: "profile-A",
    mutation: true,
    state: "queued",
    response: {
      protocolVersion: 1,
      operationId,
      state: "queued",
      data: null,
      error: null,
      verification: { storage: "not_checked", viewer: "not_checked" },
    },
  };
}

class StableDigest {
  async digest(bytes) {
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return `test:${(hash >>> 0).toString(16)}`;
  }
}

function noteRequest(operationId = "op-queued-interruption", content = "Study note") {
  return validateProtocolRequest({
    protocolVersion: 1,
    operationId,
    operation: "create_note",
    profileId: "profile-A",
    authorization: {
      kind: "explicit_request",
      scope: "Create the requested study note on ITEM1234.",
    },
    payload: { libraryId: "1", itemKey: "ITEM1234", content },
  });
}

test("a restart terminally rejects a queued claim interrupted before native execution", async () => {
  const file = new MemoryAtomicFile();
  const durable = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });
  let interruptTransition = true;
  const interruptedStore = {
    claim: (initial) => durable.claim(initial),
    load: (operationId) => durable.load(operationId),
    transition(operationId, expectedState, next) {
      if (interruptTransition && expectedState === "queued" && next.state === "running") {
        interruptTransition = false;
        throw new Error("simulated process interruption after durable claim");
      }
      return durable.transition(operationId, expectedState, next);
    },
  };
  const firstCoordinator = new OperationCoordinator({
    store: interruptedStore,
    digest: new StableDigest(),
    serializer: new KeyedMutationSerializer(),
  });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return {
      kind: "completed",
      data: { noteKey: "NOTE1234", revision: "rev:1", content: "Study note", deepLink: "zotero://note" },
      verification: { storage: "confirmed", viewer: "not_applicable" },
    };
  };

  await assert.rejects(
    firstCoordinator.submit(noteRequest(), "profile-A", execute),
    /simulated process interruption/,
  );
  assert.equal((await durable.load("op-queued-interruption")).state, "queued");
  assert.equal(executions, 0);

  const restartedStore = new DurableOperationStore(file, {
    generateProfileId: () => "must-not-replace-profile",
  });
  const restartedCoordinator = new OperationCoordinator({
    store: restartedStore,
    digest: new StableDigest(),
    serializer: new KeyedMutationSerializer(),
  });
  const mismatch = await restartedCoordinator.submit(
    noteRequest("op-queued-interruption", "Different content"),
    "profile-A",
    execute,
  );
  assert.equal(mismatch.state, "rejected");
  assert.equal(mismatch.error.code, "duplicate_id_mismatch");
  const wrongProfile = await restartedCoordinator.submit(noteRequest(), "profile-B", execute);
  assert.equal(wrongProfile.state, "rejected");
  assert.equal(wrongProfile.error.code, "permission_denied");
  assert.equal((await restartedStore.load("op-queued-interruption")).state, "queued");
  let nativeRecoveryCalls = 0;
  const startupRecovery = await restartedCoordinator.recoverPending("profile-A", {
    async reconcile() {
      nativeRecoveryCalls += 1;
      throw new Error("queued operations must not reach native recovery");
    },
  });
  assert.equal(startupRecovery.length, 1);
  assert.equal(startupRecovery[0].state, "rejected");
  assert.equal(nativeRecoveryCalls, 0);
  const recovered = await restartedCoordinator.submit(noteRequest(), "profile-A", execute);

  assert.equal(recovered.state, "rejected");
  assert.equal(recovered.error.code, "storage_error");
  assert.match(recovered.error.message, /before native execution/i);
  assert.match(recovered.error.message, /new operation ID/i);
  assert.equal(executions, 0);
  assert.deepEqual(await restartedCoordinator.submit(noteRequest(), "profile-A", execute), recovered);
  assert.equal((await restartedStore.load("op-queued-interruption")).state, "rejected");
});

test("startup recovery keeps running operations on marker reconciliation", async () => {
  const file = new MemoryAtomicFile();
  const store = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });
  const queued = record("op-running-recovery");
  await store.claim(queued);
  await store.transition("op-running-recovery", "queued", {
    ...queued,
    state: "running",
    response: { ...queued.response, state: "running" },
  });
  const restartedStore = new DurableOperationStore(file, {
    generateProfileId: () => "must-not-replace-profile",
  });
  const coordinator = new OperationCoordinator({
    store: restartedStore,
    digest: new StableDigest(),
    serializer: new KeyedMutationSerializer(),
  });
  let reconciliations = 0;
  const results = await coordinator.recoverPending("profile-A", {
    async reconcile(actual) {
      reconciliations += 1;
      assert.equal(actual.operationId, "op-running-recovery");
      return {
        kind: "completed",
        data: {
          annotationKey: "ANN00001",
          revision: "rev:1",
          deepLink: "zotero://recovered",
          saved: {},
        },
        verification: { storage: "confirmed", viewer: "not_checked" },
      };
    },
  });

  assert.equal(reconciliations, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].state, "succeeded");
  assert.equal((await restartedStore.load("op-running-recovery")).state, "succeeded");
  assert.deepEqual(await restartedStore.listPending(), []);
});

test("a live queued submission cannot be mistaken for a restart orphan", async () => {
  const file = new MemoryAtomicFile();
  const durable = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });
  let announceTransition;
  const transitionStarted = new Promise((resolve) => {
    announceTransition = resolve;
  });
  let releaseTransition;
  const transitionGate = new Promise((resolve) => {
    releaseTransition = resolve;
  });
  const gatedStore = {
    claim: (initial) => durable.claim(initial),
    load: (operationId) => durable.load(operationId),
    listPending: () => durable.listPending(),
    async transition(operationId, expectedState, next) {
      if (expectedState === "queued" && next.state === "running") {
        announceTransition();
        await transitionGate;
      }
      return durable.transition(operationId, expectedState, next);
    },
  };
  const coordinator = new OperationCoordinator({
    store: gatedStore,
    digest: new StableDigest(),
    serializer: new KeyedMutationSerializer(),
  });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return {
      kind: "completed",
      data: { noteKey: "NOTE1234", revision: "rev:1", content: "Study note", deepLink: "zotero://note" },
      verification: { storage: "confirmed", viewer: "not_applicable" },
    };
  };

  const first = coordinator.submit(noteRequest("op-live-queued"), "profile-A", execute);
  await transitionStarted;
  assert.equal((await durable.load("op-live-queued")).state, "queued");
  let duplicateSettled = false;
  const duplicate = coordinator
    .submit(noteRequest("op-live-queued"), "profile-A", execute)
    .finally(() => {
      duplicateSettled = true;
    });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(duplicateSettled, false);
  assert.equal((await durable.load("op-live-queued")).state, "queued");

  releaseTransition();
  const [created, replay] = await Promise.all([first, duplicate]);
  assert.equal(created.state, "succeeded");
  assert.deepEqual(replay, created);
  assert.equal(executions, 1);
  assert.equal((await durable.load("op-live-queued")).state, "succeeded");
});

test("an operation claim and terminal response survive a new store instance", async () => {
  const file = new MemoryAtomicFile();
  const first = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });
  assert.equal(await first.profileId(), "profile-A");
  assert.equal((await first.claim(record())).kind, "created");

  const queued = await first.load("op-1");
  const running = {
    ...queued,
    state: "running",
    response: { ...queued.response, state: "running" },
  };
  await first.transition("op-1", "queued", running);
  const succeeded = {
    ...running,
    state: "succeeded",
    response: {
      ...running.response,
      state: "succeeded",
      data: { annotationKey: "ANN00001" },
      verification: { storage: "confirmed", viewer: "not_checked" },
    },
  };
  await first.transition("op-1", "running", succeeded);

  const afterRestart = new DurableOperationStore(file, {
    generateProfileId: () => "must-not-replace-profile",
  });
  assert.equal(await afterRestart.profileId(), "profile-A");
  assert.deepEqual(await afterRestart.load("op-1"), succeeded);
  assert.equal((await afterRestart.claim(record())).kind, "existing");
});

test("claim never replaces an existing ID even when a different digest is presented", async () => {
  const file = new MemoryAtomicFile();
  const store = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });
  await store.claim(record("op-fixed", "sha256:first"));

  const claim = await store.claim(record("op-fixed", "sha256:different"));
  assert.equal(claim.kind, "existing");
  assert.equal(claim.record.requestDigest, "sha256:first");
  assert.equal((await store.load("op-fixed")).requestDigest, "sha256:first");
});

test("valid IDs that name Object prototype properties remain ordinary durable records", async () => {
  const file = new MemoryAtomicFile();
  const store = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });

  assert.equal((await store.claim(record("constructor"))).kind, "created");
  assert.equal((await store.claim(record("toString"))).kind, "created");
  assert.equal((await store.claim(record("__proto__"))).kind, "created");
  assert.equal((await store.load("constructor")).operationId, "constructor");
  assert.equal((await store.load("toString")).operationId, "toString");
  assert.equal((await store.load("__proto__")).operationId, "__proto__");

  const restarted = new DurableOperationStore(file, {
    generateProfileId: () => "must-not-run",
  });
  assert.equal((await restarted.claim(record("constructor"))).kind, "existing");
  assert.equal((await restarted.claim(record("toString"))).kind, "existing");
  assert.equal((await restarted.claim(record("__proto__"))).kind, "existing");
});

test("prototype-named IDs survive an atomic file round trip", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zotero-operation-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "nested", "operations.json");
  const io = {
    async exists(candidate) {
      try {
        await access(candidate);
        return true;
      } catch {
        return false;
      }
    },
    async makeDirectory(candidate) {
      await mkdir(candidate, { recursive: true });
    },
    async readUTF8(candidate) {
      return readFile(candidate, "utf8");
    },
    async writeUTF8(candidate, text, options = {}) {
      const temporary = options.tmpPath ?? `${candidate}.tmp`;
      await writeFile(temporary, text, "utf8");
      await rename(temporary, candidate);
    },
  };
  const paths = { parent: dirname, join };
  const file = new IOUtilsAtomicTextFile(io, paths, path);
  const first = new DurableOperationStore(file, { generateProfileId: () => "profile-file" });
  for (const id of ["constructor", "toString", "__proto__"]) {
    assert.equal((await first.claim(record(id))).kind, "created");
  }

  const disk = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(Object.keys(disk.operations).sort(), ["__proto__", "constructor", "toString"]);
  const restarted = new DurableOperationStore(
    new IOUtilsAtomicTextFile(io, paths, path),
    { generateProfileId: () => "must-not-replace" },
  );
  for (const id of ["constructor", "toString", "__proto__"]) {
    assert.equal((await restarted.load(id)).operationId, id);
  }
});

test("optimistic transitions reject stale writers without altering durable state", async () => {
  const file = new MemoryAtomicFile();
  const store = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });
  await store.claim(record());
  const next = { ...record(), state: "running", response: { ...record().response, state: "running" } };

  await assert.rejects(() => store.transition("op-1", "running", next), /expected state/i);
  assert.equal((await store.load("op-1")).state, "queued");
});

test("mutation serializer orders work per profile while allowing other profiles to proceed", async () => {
  const serializer = new KeyedMutationSerializer();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = serializer.runExclusive("profile-A", async () => {
    events.push("a1-start");
    await firstGate;
    events.push("a1-end");
  });
  const second = serializer.runExclusive("profile-A", async () => {
    events.push("a2");
  });
  const other = serializer.runExclusive("profile-B", async () => {
    events.push("b1");
  });

  await other;
  assert.deepEqual(events, ["a1-start", "b1"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["a1-start", "b1", "a1-end", "a2"]);
});

test("a running arXiv import checkpoints immutable native recovery evidence atomically", async () => {
  const file = new MemoryAtomicFile();
  const store = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });
  const queued = {
    ...record("op-arxiv-stage"),
    operation: "ensure_arxiv_pdf",
  };
  await store.claim(queued);
  await store.transition("op-arxiv-stage", "queued", {
    ...queued,
    state: "running",
    response: { ...queued.response, state: "running" },
  });
  const evidence = {
    kind: "arxiv_import",
    stage: "prepared",
    source: {
      arxivId: "2401.01234",
      version: 2,
      abstractUrl: "https://arxiv.org/abs/2401.01234v2",
      pdfUrl: "https://arxiv.org/pdf/2401.01234v2",
      metadata: {
        title: "Fixture article",
        authors: ["Ada Example"],
        published: "2024-01-03T00:00:00Z",
        updated: "2024-01-04T00:00:00Z",
        abstract: "Fixture abstract",
      },
    },
    libraryId: "1",
    inspectionToken: "token-a",
    selection: { kind: "create" },
    initialCandidates: [],
    expectedPdf: {
      fingerprint: "sha256:pdf-a",
      byteLength: 20,
      pageCount: 2,
      stagingId: "stage-owned-a",
    },
    itemKey: "ITEMPLAN1",
    itemAction: "created",
    pdfAction: "downloaded",
    attachmentKey: "ATTPLAN1",
    operationMarker: "urn:operation:a",
    parentProvenance: "urn:arxiv:parent:a",
    attachmentProvenance: "urn:arxiv:pdf:a",
  };

  const checkpointed = await store.checkpointNativeEvidence("op-arxiv-stage", evidence);
  assert.deepEqual(checkpointed.nativeEvidence, evidence);
  assert.deepEqual((await store.load("op-arxiv-stage")).nativeEvidence, evidence);

  await assert.rejects(
    () => store.checkpointNativeEvidence("op-arxiv-stage", {
      ...evidence,
      source: {
        ...evidence.source,
        version: 3,
        abstractUrl: "https://arxiv.org/abs/2401.01234v3",
        pdfUrl: "https://arxiv.org/pdf/2401.01234v3",
      },
      stage: "parent_committed",
    }),
    /immutable/i,
  );
  assert.deepEqual((await store.load("op-arxiv-stage")).nativeEvidence, evidence);
});

test("a 0.1.0 journal without native recovery evidence remains readable", async () => {
  const legacy = record("op-legacy-0.1.0");
  const file = new MemoryAtomicFile();
  file.text = `${JSON.stringify({
    schemaVersion: 1,
    profileId: "profile-A",
    operations: { [legacy.operationId]: legacy },
  })}\n`;

  const store = new DurableOperationStore(file, {
    generateProfileId: () => "must-not-replace-profile",
  });
  const loaded = await store.load(legacy.operationId);

  assert.deepEqual(loaded, legacy);
  assert.equal("nativeEvidence" in loaded, false);
});
