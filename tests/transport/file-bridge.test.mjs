import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { OperationCoordinator } from "../../dist/core/index.js";
import {
  FileBridgeConfigurationError,
  FileBridgeSecurityError,
  FileBridgeTransport,
  MAX_FILE_BRIDGE_REQUESTS_PER_SCAN,
  MAX_FILE_BRIDGE_RESULT_BYTES,
} from "../../dist/adapters/file-bridge/index.js";
import { MAX_REQUEST_BYTES } from "../../dist/protocol/index.js";

const encoder = new TextEncoder();

class NodeFileBridgeFileSystem {
  beforeAtomicWrite;
  beforeReadBounded;

  isAbsolute(value) {
    return path.isAbsolute(value);
  }

  join(...parts) {
    return path.join(...parts);
  }

  filename(value) {
    return path.basename(value);
  }

  parent(value) {
    const parent = path.dirname(value);
    return parent === value ? null : parent;
  }

  async canonicalizeExisting(value) {
    return realpath(value);
  }

  async inspect(value) {
    try {
      const info = await lstat(value);
      if (info.isSymbolicLink()) return { kind: "symlink", size: 0 };
      if (info.isFile()) return { kind: "file", size: info.size };
      if (info.isDirectory()) return { kind: "directory", size: 0 };
      return { kind: "other", size: 0 };
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async createDirectory(value, options = {}) {
    await mkdir(value, {
      recursive: options.exclusive !== true,
      mode: 0o700,
    });
  }

  async list(value) {
    return (await readdir(value)).map((name) => path.join(value, name));
  }

  async readBounded(value, maxBytes) {
    await this.beforeReadBounded?.(value, maxBytes);
    const handle = await open(value, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const chunks = [];
      let total = 0;
      while (total < maxBytes) {
        const remaining = maxBytes - total;
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        chunks.push(buffer.subarray(0, bytesRead));
        total += bytesRead;
      }
      return new Uint8Array(Buffer.concat(chunks, total));
    } finally {
      await handle.close();
    }
  }

  async atomicWrite(value, bytes, temporaryPath) {
    await this.beforeAtomicWrite?.(value, bytes, temporaryPath);
    const handle = await open(temporaryPath, "w", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, value);
  }
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

  async transition(operationId, expectedState, next) {
    const current = this.records.get(operationId);
    assert.equal(current?.state, expectedState);
    this.records.set(operationId, structuredClone(next));
    return structuredClone(next);
  }
}

class InlineSerializer {
  async runExclusive(_profileId, work) {
    return work();
  }
}

function createCoordinatorHandler(execute) {
  const coordinator = new OperationCoordinator({
    store: new MemoryOperationStore(),
    digest: new StableDigest(),
    serializer: new InlineSerializer(),
  });
  return (request, profileId) => coordinator.submit(request, profileId, execute);
}

function request(operationId, overrides = {}) {
  return {
    protocolVersion: 1,
    operationId,
    operation: "search_papers",
    profileId: "profile-A",
    payload: { query: "Bayesian inference", limit: 10 },
    ...overrides,
  };
}

function mutationRequest(operationId, content = "A study note") {
  return {
    protocolVersion: 1,
    operationId,
    operation: "create_note",
    profileId: "profile-A",
    authorization: {
      kind: "explicit_request",
      scope: "Save this new child note on ITEM1234.",
    },
    payload: { libraryId: "1", itemKey: "ITEM1234", content },
  };
}

async function withBridge(t, options = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zotero-file-bridge-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fileSystem = new NodeFileBridgeFileSystem();
  let sessionNumber = 0;
  const transport = new FileBridgeTransport({
    fileSystem,
    directory: root,
    connectedProfileId: "profile-A",
    pollIntervalMs: 60_000,
    onError: () => {},
    createSessionId: () =>
      options.sessionIds?.[sessionNumber++] ?? `${String(sessionNumber).padStart(32, "0")}`,
    maxResultBytes: options.maxResultBytes,
  });
  return { root, fileSystem, transport };
}

async function publishJson(subscription, operationId, value) {
  const target = path.join(subscription.paths.requestDirectory, `${operationId}.request.json`);
  const temporary = `${target}.partial`;
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  return target;
}

async function readResult(subscription, operationId) {
  const target = path.join(subscription.paths.resultDirectory, `${operationId}.result.json`);
  return JSON.parse(await readFile(target, "utf8"));
}

async function readSessionStatus(root, readiness) {
  return JSON.parse(await readFile(path.join(root, readiness.statusFile), "utf8"));
}

test("real filesystem request/result round trip publishes bounded UTF-8 JSON atomically", async (t) => {
  const { root, transport } = await withBridge(t);
  let executions = 0;
  const handler = createCoordinatorHandler(async (accepted) => {
    executions += 1;
    assert.equal(accepted.operation, "search_papers");
    return {
      kind: "completed",
      data: { matches: [] },
      verification: { storage: "not_applicable", viewer: "not_checked" },
    };
  });
  const subscription = await transport.listen(handler);
  t.after(() => subscription.close());

  assert.equal(Object.hasOwn(subscription.readiness, "enabled"), false);
  assert.equal(subscription.readiness.protocolVersion, 1);
  assert.equal(subscription.readiness.bridgeVersion, 1);
  assert.equal(subscription.readiness.profileId, "profile-A");
  assert.equal(subscription.readiness.maxRequestBytes, MAX_REQUEST_BYTES);
  assert.equal(subscription.readiness.maxResultBytes, MAX_FILE_BRIDGE_RESULT_BYTES);
  assert.equal(path.isAbsolute(subscription.readiness.requestDirectory), false);
  assert.equal(path.isAbsolute(subscription.readiness.statusFile), false);
  assert.equal(path.isAbsolute(subscription.paths.requestDirectory), true);
  const status = await readSessionStatus(root, subscription.readiness);
  assert.equal(status.enabled, true);
  assert.equal(status.sessionId, subscription.readiness.sessionId);

  await publishJson(subscription, "op.search-1", request("op.search-1"));
  await subscription.pollOnce();

  const result = await readResult(subscription, "op.search-1");
  assert.equal(result.state, "succeeded");
  assert.deepEqual(result.data, { matches: [] });
  assert.equal(executions, 1);
  assert.deepEqual(
    (await readdir(subscription.paths.resultDirectory)).sort(),
    ["op.search-1.result.json"],
  );
});

test("partial and malformed publications never reach the dispatcher", async (t) => {
  const { transport } = await withBridge(t);
  let dispatches = 0;
  const subscription = await transport.listen(async () => {
    dispatches += 1;
    throw new Error("malformed input must not dispatch");
  });
  t.after(() => subscription.close());

  const ignored = path.join(
    subscription.paths.requestDirectory,
    "op.interrupted-1.request.json.partial",
  );
  await writeFile(ignored, '{"protocolVersion":1', "utf8");
  await subscription.pollOnce();
  assert.equal(dispatches, 0);
  await assert.rejects(readResult(subscription, "op.interrupted-1"), /ENOENT/);

  const malformed = path.join(
    subscription.paths.requestDirectory,
    "op.interrupted-1.request.json",
  );
  await writeFile(malformed, '{"protocolVersion":1', "utf8");
  await subscription.pollOnce();
  const result = await readResult(subscription, "op.interrupted-1");
  assert.equal(result.state, "rejected");
  assert.equal(result.error.code, "invalid_request");
  assert.equal(dispatches, 0);
});

test("unsupported envelopes, invalid UTF-8, and filename mismatches do not dispatch", async (t) => {
  const { transport } = await withBridge(t);
  let dispatches = 0;
  const subscription = await transport.listen(async () => {
    dispatches += 1;
    throw new Error("invalid envelope must not dispatch");
  });
  t.after(() => subscription.close());

  await publishJson(
    subscription,
    "op.version-1",
    request("op.version-1", { protocolVersion: 2 }),
  );
  await publishJson(
    subscription,
    "op.operation-1",
    request("op.operation-1", { operation: "delete_library" }),
  );
  await publishJson(
    subscription,
    "op.unknown-field-1",
    request("op.unknown-field-1", { unexpected: true }),
  );
  await publishJson(subscription, "op.filename-1", request("op.different-id-1"));
  await writeFile(
    path.join(subscription.paths.requestDirectory, "op.utf8-1.request.json"),
    Buffer.from([0xff, 0xfe]),
  );

  await subscription.pollOnce();
  assert.equal((await readResult(subscription, "op.version-1")).error.code, "unsupported_version");
  assert.equal(
    (await readResult(subscription, "op.operation-1")).error.code,
    "unsupported_operation",
  );
  assert.equal(
    (await readResult(subscription, "op.unknown-field-1")).error.code,
    "invalid_request",
  );
  assert.equal((await readResult(subscription, "op.filename-1")).error.code, "invalid_request");
  assert.equal((await readResult(subscription, "op.utf8-1")).error.code, "invalid_request");
  assert.equal(dispatches, 0);
});

test("durable identity replays same payload and rejects a changed payload", async (t) => {
  const { transport } = await withBridge(t);
  let executions = 0;
  const handler = createCoordinatorHandler(async () => {
    executions += 1;
    return {
      kind: "completed",
      data: { matches: [{ title: "First durable result" }] },
      verification: { storage: "not_applicable", viewer: "not_checked" },
    };
  });
  const subscription = await transport.listen(handler);
  t.after(() => subscription.close());

  await publishJson(subscription, "op.duplicate-1", request("op.duplicate-1"));
  await subscription.pollOnce();
  await subscription.pollOnce();
  assert.equal(executions, 1);
  assert.equal((await readResult(subscription, "op.duplicate-1")).state, "succeeded");

  await publishJson(
    subscription,
    "op.duplicate-1",
    request("op.duplicate-1", { payload: { query: "Different query", limit: 10 } }),
  );
  await subscription.pollOnce();
  const mismatch = await readResult(subscription, "op.duplicate-1");
  assert.equal(mismatch.state, "rejected");
  assert.equal(mismatch.error.code, "duplicate_id_mismatch");
  assert.equal(executions, 1);
});

test("an indeterminate mutation cache rejects changed content and replays canonical identity", async (t) => {
  const { transport } = await withBridge(t);
  let dispatches = 0;
  const subscription = await transport.listen(async () => {
    dispatches += 1;
    throw new Error("native outcome unavailable");
  });
  t.after(() => subscription.close());

  const operationId = "op.indeterminate-identity-1";
  const original = mutationRequest(operationId, "original content");
  await publishJson(subscription, operationId, original);
  await subscription.pollOnce();
  const first = await readResult(subscription, operationId);
  assert.equal(first.state, "indeterminate");
  assert.equal(first.error.code, "unknown_outcome");
  assert.equal(dispatches, 1);

  await publishJson(subscription, operationId, mutationRequest(operationId, "changed content"));
  await subscription.pollOnce();
  const mismatch = await readResult(subscription, operationId);
  assert.equal(mismatch.state, "rejected");
  assert.equal(mismatch.error.code, "duplicate_id_mismatch");
  assert.equal(dispatches, 1);

  const canonicalReplay = {
    payload: {
      content: "original content",
      itemKey: original.payload.itemKey,
      libraryId: original.payload.libraryId,
    },
    authorization: { ...original.authorization },
    profileId: original.profileId,
    operation: original.operation,
    operationId: original.operationId,
    protocolVersion: original.protocolVersion,
  };
  await publishJson(subscription, operationId, canonicalReplay);
  await subscription.pollOnce();
  const replay = await readResult(subscription, operationId);
  assert.equal(replay.state, "indeterminate");
  assert.equal(replay.error.code, "unknown_outcome");
  assert.equal(dispatches, 1);
});

test("disabled bridge does not process files published after close", async (t) => {
  const { root, transport } = await withBridge(t);
  let dispatches = 0;
  const subscription = await transport.listen(async () => {
    dispatches += 1;
    throw new Error("closed bridge must not dispatch");
  });
  await subscription.close();

  const descriptor = JSON.parse(await readFile(path.join(root, "bridge-v1.json"), "utf8"));
  assert.equal(descriptor.sessionId, subscription.readiness.sessionId);
  const disabled = await readSessionStatus(root, descriptor);
  assert.equal(disabled.enabled, false);
  await publishJson(subscription, "op.disabled-1", mutationRequest("op.disabled-1"));
  await subscription.pollOnce();
  assert.equal(dispatches, 0);
  await assert.rejects(readResult(subscription, "op.disabled-1"), /ENOENT/);
});

test("wrong profile is rejected by the bridge before dispatch", async (t) => {
  const { transport } = await withBridge(t);
  let dispatches = 0;
  const subscription = await transport.listen(async () => {
    dispatches += 1;
    throw new Error("wrong profile must not dispatch");
  });
  t.after(() => subscription.close());

  const wrongProfile = mutationRequest("op.wrong-profile-1");
  wrongProfile.profileId = "profile-B";
  await publishJson(subscription, wrongProfile.operationId, wrongProfile);
  await subscription.pollOnce();

  const result = await readResult(subscription, wrongProfile.operationId);
  assert.equal(result.state, "rejected");
  assert.equal(result.error.code, "permission_denied");
  assert.equal(dispatches, 0);
});

test("symlinked mutation requests are rejected without reading or dispatching", async (t) => {
  const { transport } = await withBridge(t);
  let dispatches = 0;
  const subscription = await transport.listen(async () => {
    dispatches += 1;
    throw new Error("symlink request must not dispatch");
  });
  t.after(() => subscription.close());

  const outside = path.join(os.tmpdir(), `outside-${process.pid}-${Date.now()}.json`);
  t.after(() => rm(outside, { force: true }));
  await writeFile(outside, JSON.stringify(mutationRequest("op.symlink-1")), "utf8");
  const linked = path.join(subscription.paths.requestDirectory, "op.symlink-1.request.json");
  await symlink(outside, linked);
  await subscription.pollOnce();

  const result = await readResult(subscription, "op.symlink-1");
  assert.equal(result.state, "rejected");
  assert.equal(result.error.code, "permission_denied");
  assert.equal(dispatches, 0);
});

test("oversized requests are rejected using a bounded read", async (t) => {
  const { transport } = await withBridge(t);
  let dispatches = 0;
  const subscription = await transport.listen(async () => {
    dispatches += 1;
    throw new Error("oversized request must not dispatch");
  });
  t.after(() => subscription.close());

  const target = path.join(
    subscription.paths.requestDirectory,
    "op.oversized-bridge-1.request.json",
  );
  await writeFile(target, Buffer.alloc(MAX_REQUEST_BYTES + 1, 0x78));
  await subscription.pollOnce();

  const result = await readResult(subscription, "op.oversized-bridge-1");
  assert.equal(result.state, "rejected");
  assert.equal(result.error.code, "too_large");
  assert.equal(dispatches, 0);
});

test("oversized and binary handler results are not emitted or silently truncated", async (t) => {
  const { transport } = await withBridge(t, { maxResultBytes: 1024 });
  const subscription = await transport.listen(async (accepted) => {
    if (accepted.operationId === "op.result-large-1") {
      return {
        protocolVersion: 1,
        operationId: accepted.operationId,
        state: "succeeded",
        data: { matches: [{ title: "x".repeat(2048) }] },
        error: null,
        verification: { storage: "not_applicable", viewer: "not_checked" },
      };
    }
    return {
      protocolVersion: 1,
      operationId: accepted.operationId,
      state: "succeeded",
      data: { pdfBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
      error: null,
      verification: { storage: "not_applicable", viewer: "not_checked" },
    };
  });
  t.after(() => subscription.close());

  await publishJson(subscription, "op.result-large-1", request("op.result-large-1"));
  await publishJson(
    subscription,
    "op.result-binary-1",
    request("op.result-binary-1", {
      operation: "read_pdf",
      payload: {
        libraryId: "1",
        itemKey: "ITEM1234",
        attachmentKey: "ATTACH01",
        pageRange: { startPageIndex: 0, endPageIndex: 0 },
      },
    }),
  );
  await subscription.pollOnce();

  const oversized = await readResult(subscription, "op.result-large-1");
  assert.equal(oversized.state, "failed");
  assert.equal(oversized.error.code, "too_large");
  assert.ok(
    (await lstat(path.join(subscription.paths.resultDirectory, "op.result-large-1.result.json")))
      .size <= 1024,
  );
  const binary = await readResult(subscription, "op.result-binary-1");
  assert.equal(binary.state, "failed");
  assert.equal(binary.error.code, "storage_error");
  assert.match(binary.error.message, /plain JSON/i);
});

test("new session ignores stale pending mutations and requires fresh publication", async (t) => {
  const { fileSystem, root } = await withBridge(t, {
    sessionIds: ["11111111111111111111111111111111", "22222222222222222222222222222222"],
  });
  let writes = 0;
  const handler = createCoordinatorHandler(async (accepted) => {
    writes += 1;
    return {
      kind: "completed",
      data: {
        noteKey: `NOTE${writes}`,
        revision: `rev:${writes}`,
        content: accepted.payload.content,
        deepLink: `zotero://select/library/items/NOTE${writes}`,
      },
      verification: { storage: "confirmed", viewer: "not_checked" },
    };
  });

  const firstTransport = new FileBridgeTransport({
    fileSystem,
    directory: root,
    connectedProfileId: "profile-A",
    pollIntervalMs: 60_000,
    createSessionId: () => "11111111111111111111111111111111",
    onError: () => {},
  });
  const first = await firstTransport.listen(handler);
  await first.close();
  await publishJson(first, "op.stale-1", mutationRequest("op.stale-1", "stale"));

  const secondTransport = new FileBridgeTransport({
    fileSystem,
    directory: root,
    connectedProfileId: "profile-A",
    pollIntervalMs: 60_000,
    createSessionId: () => "22222222222222222222222222222222",
    onError: () => {},
  });
  const second = await secondTransport.listen(handler);
  t.after(() => second.close());
  await second.pollOnce();
  assert.equal(writes, 0);
  await assert.rejects(readResult(first, "op.stale-1"), /ENOENT/);

  await publishJson(second, "op.fresh-1", mutationRequest("op.fresh-1", "fresh"));
  await second.pollOnce();
  assert.equal(writes, 1);
  assert.equal((await readResult(second, "op.fresh-1")).state, "succeeded");
});

test("one runtime refuses two active owners for the same bridge root", async (t) => {
  const { fileSystem, root } = await withBridge(t);
  let writes = 0;
  const handler = createCoordinatorHandler(async (accepted) => {
    writes += 1;
    return {
      kind: "completed",
      data: {
        noteKey: "NOTE1",
        revision: "rev:1",
        content: accepted.payload.content,
        deepLink: "zotero://select/library/items/NOTE1",
      },
      verification: { storage: "confirmed", viewer: "not_checked" },
    };
  });
  const firstTransport = new FileBridgeTransport({
    fileSystem,
    directory: root,
    connectedProfileId: "profile-A",
    pollIntervalMs: 60_000,
    createSessionId: () => "33333333333333333333333333333333",
    onError: () => {},
  });
  const secondTransport = new FileBridgeTransport({
    fileSystem,
    directory: root,
    connectedProfileId: "profile-A",
    pollIntervalMs: 60_000,
    createSessionId: () => "44444444444444444444444444444444",
    onError: () => {},
  });
  const first = await firstTransport.listen(handler);
  await assert.rejects(secondTransport.listen(handler), FileBridgeConfigurationError);

  await first.close();
  const second = await secondTransport.listen(handler);
  t.after(() => second.close());
  await publishJson(second, "op.new-owner-1", mutationRequest("op.new-owner-1"));
  await second.pollOnce();
  assert.equal(writes, 1);
});

test("an old close cannot overwrite a newer descriptor across isolated runtimes", async (t) => {
  const { fileSystem, root } = await withBridge(t);
  const handler = createCoordinatorHandler(async () => ({
    kind: "completed",
    data: { matches: [] },
    verification: { storage: "not_applicable", viewer: "not_checked" },
  }));
  const firstTransport = new FileBridgeTransport({
    fileSystem,
    directory: root,
    connectedProfileId: "profile-A",
    pollIntervalMs: 60_000,
    createSessionId: () => "55555555555555555555555555555555",
    onError: () => {},
  });
  const first = await firstTransport.listen(handler);

  let markClosePaused;
  let releaseClose;
  const closePaused = new Promise((resolve) => {
    markClosePaused = resolve;
  });
  const closeMayFinish = new Promise((resolve) => {
    releaseClose = resolve;
  });
  t.after(() => releaseClose());
  fileSystem.beforeAtomicWrite = async (target, bytes) => {
    if (target !== first.paths.statusFile) return;
    const status = JSON.parse(new TextDecoder().decode(bytes));
    if (status.enabled !== false) return;
    fileSystem.beforeAtomicWrite = undefined;
    markClosePaused();
    await closeMayFinish;
  };

  const closingFirst = first.close();
  await closePaused;

  const isolatedModule = await import(
    "../../dist/adapters/file-bridge/file-bridge.js?isolated-runtime=close-race"
  );
  const secondTransport = new isolatedModule.FileBridgeTransport({
    fileSystem,
    directory: root,
    connectedProfileId: "profile-A",
    pollIntervalMs: 60_000,
    createSessionId: () => "66666666666666666666666666666666",
    onError: () => {},
  });
  const second = await secondTransport.listen(handler);
  t.after(() => second.close());
  const beforeRelease = JSON.parse(await readFile(path.join(root, "bridge-v1.json"), "utf8"));
  assert.equal(beforeRelease.sessionId, second.readiness.sessionId);

  releaseClose();
  await closingFirst;

  const afterRelease = JSON.parse(await readFile(path.join(root, "bridge-v1.json"), "utf8"));
  assert.equal(afterRelease.sessionId, second.readiness.sessionId);
  assert.equal((await readSessionStatus(root, first.readiness)).enabled, false);
  assert.equal((await readSessionStatus(root, second.readiness)).enabled, true);

  await publishJson(second, "op.new-process-1", request("op.new-process-1"));
  await second.pollOnce();
  assert.equal((await readResult(second, "op.new-process-1")).state, "succeeded");
});

test("descriptor-status-descriptor confirmation fences a superseded process", async (t) => {
  const { fileSystem, root } = await withBridge(t);
  let writes = 0;
  const handler = createCoordinatorHandler(async (accepted) => {
    writes += 1;
    return {
      kind: "completed",
      data: {
        noteKey: "NOTE1",
        revision: "rev:1",
        content: accepted.payload.content,
        deepLink: "zotero://select/library/items/NOTE1",
      },
      verification: { storage: "confirmed", viewer: "not_checked" },
    };
  });
  const firstTransport = new FileBridgeTransport({
    fileSystem,
    directory: root,
    connectedProfileId: "profile-A",
    pollIntervalMs: 60_000,
    createSessionId: () => "77777777777777777777777777777777",
    onError: () => {},
  });
  const first = await firstTransport.listen(handler);
  t.after(() => first.close());
  await publishJson(first, "op.fenced-1", mutationRequest("op.fenced-1"));

  let markStatusRead;
  let releaseStatusRead;
  const statusRead = new Promise((resolve) => {
    markStatusRead = resolve;
  });
  const statusMayFinish = new Promise((resolve) => {
    releaseStatusRead = resolve;
  });
  t.after(() => releaseStatusRead());
  fileSystem.beforeReadBounded = async (target) => {
    if (target !== first.paths.statusFile) return;
    fileSystem.beforeReadBounded = undefined;
    markStatusRead();
    await statusMayFinish;
  };

  const firstPoll = first.pollOnce();
  await statusRead;
  const isolatedModule = await import(
    "../../dist/adapters/file-bridge/file-bridge.js?isolated-runtime=status-race"
  );
  const secondTransport = new isolatedModule.FileBridgeTransport({
    fileSystem,
    directory: root,
    connectedProfileId: "profile-A",
    pollIntervalMs: 60_000,
    createSessionId: () => "88888888888888888888888888888888",
    onError: () => {},
  });
  const second = await secondTransport.listen(handler);
  t.after(() => second.close());

  releaseStatusRead();
  await assert.rejects(firstPoll, FileBridgeSecurityError);
  assert.equal(writes, 0);
});

test("the per-scan bound advances fairly instead of starving later requests", async (t) => {
  const { transport } = await withBridge(t);
  let executions = 0;
  const subscription = await transport.listen(
    createCoordinatorHandler(async () => {
      executions += 1;
      return {
        kind: "completed",
        data: { matches: [] },
        verification: { storage: "not_applicable", viewer: "not_checked" },
      };
    }),
  );
  t.after(() => subscription.close());

  const requestCount = MAX_FILE_BRIDGE_REQUESTS_PER_SCAN + 1;
  for (let index = 0; index < requestCount; index += 1) {
    const operationId = `op.bound-${String(index).padStart(3, "0")}`;
    await publishJson(subscription, operationId, request(operationId));
  }

  await subscription.pollOnce();
  assert.equal(executions, MAX_FILE_BRIDGE_REQUESTS_PER_SCAN);
  await assert.rejects(
    readResult(subscription, `op.bound-${String(requestCount - 1).padStart(3, "0")}`),
    /ENOENT/,
  );

  await subscription.pollOnce();
  assert.equal(executions, requestCount);
  assert.equal(
    (await readResult(
      subscription,
      `op.bound-${String(requestCount - 1).padStart(3, "0")}`,
    )).state,
    "succeeded",
  );
});

test("failed result publication retries through durable identity without repeating mutation", async (t) => {
  const { transport } = await withBridge(t);
  let nativeWrites = 0;
  let markHandlerEntered;
  let releaseHandler;
  const handlerEntered = new Promise((resolve) => {
    markHandlerEntered = resolve;
  });
  const handlerMayFinish = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  const handler = createCoordinatorHandler(async (accepted) => {
    nativeWrites += 1;
    markHandlerEntered();
    await handlerMayFinish;
    return {
      kind: "completed",
      data: {
        noteKey: "NOTE1",
        revision: "rev:1",
        content: accepted.payload.content,
        deepLink: "zotero://select/library/items/NOTE1",
      },
      verification: { storage: "confirmed", viewer: "failed" },
    };
  });
  const subscription = await transport.listen(handler);
  t.after(() => subscription.close());
  await publishJson(subscription, "op.retry-1", mutationRequest("op.retry-1"));

  const resultPath = path.join(subscription.paths.resultDirectory, "op.retry-1.result.json");
  const outside = path.join(os.tmpdir(), `result-outside-${process.pid}-${Date.now()}.json`);
  t.after(() => rm(outside, { force: true }));
  await writeFile(outside, "outside must stay unchanged", "utf8");
  const firstPoll = subscription.pollOnce();
  await handlerEntered;
  await symlink(outside, resultPath);
  releaseHandler();
  await assert.rejects(firstPoll, FileBridgeSecurityError);
  assert.equal(nativeWrites, 1);
  assert.equal(await readFile(outside, "utf8"), "outside must stay unchanged");

  await rm(resultPath);
  await subscription.pollOnce();
  const result = await readResult(subscription, "op.retry-1");
  assert.equal(result.state, "succeeded");
  assert.equal(result.verification.storage, "confirmed");
  assert.equal(result.verification.viewer, "failed");
  assert.equal(nativeWrites, 1);
});

test("configured root replacement is detected again before every scan", async (t) => {
  const { root, transport } = await withBridge(t);
  const subscription = await transport.listen(async () => {
    throw new Error("replaced root must not dispatch");
  });

  const moved = `${root}-moved`;
  const outside = `${root}-outside`;
  t.after(() => rm(moved, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(outside, { mode: 0o700 });
  await rename(root, moved);
  await symlink(outside, root);

  await assert.rejects(subscription.pollOnce(), FileBridgeSecurityError);
  await subscription.close();
});
