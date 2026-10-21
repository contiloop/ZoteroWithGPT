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
