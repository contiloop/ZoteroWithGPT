import assert from "node:assert/strict";
import { mkdir, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  BridgeAdapterError,
  MAX_SERVER_RESULT_BYTES,
  NodeFileBridgeAdapter,
  NodeSecureFileSystem,
} from "../src/node-file-bridge.mjs";
import {
  connectionFor,
  createControlledBridgeFixture,
  succeeded,
} from "./helpers/controlled-bridge-fixture.mjs";

function searchRequest(fixture, operationId = "search-1", query = "bayesian") {
  return {
    protocolVersion: 1,
    operationId,
    operation: "search_papers",
    profileId: fixture.profileId,
    payload: { query, limit: 25 },
  };
}

test("current-session gate confines canonical directories and exact caller binding", async (t) => {
  const fixture = await createControlledBridgeFixture(t, {
    maxResultBytes: MAX_SERVER_RESULT_BYTES * 2,
  });
  const adapter = new NodeFileBridgeAdapter({ root: fixture.root });
  const session = await adapter.openCurrent(connectionFor(fixture));
  assert.deepEqual(session.connection, connectionFor(fixture));
  assert.equal(session.maxResultBytes, MAX_SERVER_RESULT_BYTES);

  await assert.rejects(
    adapter.openCurrent({ ...connectionFor(fixture), profileId: "another-profile" }),
    (error) => error instanceof BridgeAdapterError && error.code === "connection_changed",
  );

  const outside = path.join(fixture.root, "outside");
  await mkdir(outside);
  await rename(fixture.requestDirectory, `${fixture.requestDirectory}.real`);
  await symlink(outside, fixture.requestDirectory);
  await assert.rejects(
    adapter.openCurrent(connectionFor(fixture)),
    (error) => error instanceof BridgeAdapterError && error.code === "access_denied",
  );
});

test("descriptor escape and replacement and disable races stop before publication", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const descriptorPath = path.join(fixture.root, "bridge-v1.json");
  const escaped = { ...fixture.descriptor, requestDirectory: "../outside" };
  await writeFile(descriptorPath, JSON.stringify(escaped));
  await assert.rejects(
    new NodeFileBridgeAdapter({ root: fixture.root }).openCurrent(),
    (error) => error.code === "access_denied" && error.publication === "not_published",
  );

  await writeFile(descriptorPath, JSON.stringify(fixture.descriptor));
  let descriptorReads = 0;
  const replacingFileSystem = new NodeSecureFileSystem({
    afterRead: async (filename) => {
      if (filename !== descriptorPath || ++descriptorReads !== 1) return;
      const replacement = { ...fixture.descriptor, maxRequestsPerScan: 99 };
      const temporary = `${descriptorPath}.replacement`;
      await writeFile(temporary, JSON.stringify(replacement));
      await rename(temporary, descriptorPath);
    },
  });
  await assert.rejects(
    new NodeFileBridgeAdapter({ root: fixture.root, fileSystem: replacingFileSystem }).openCurrent(),
    (error) => error.code === "connection_changed" && error.publication === "not_published",
  );

  await writeFile(descriptorPath, JSON.stringify(fixture.descriptor));
  let raced = false;
  const disablingFileSystem = new NodeSecureFileSystem({
    afterRead: async (filename) => {
      if (filename !== descriptorPath || raced) return;
      raced = true;
      await writeFile(fixture.statusPath, JSON.stringify({ ...fixture.status, enabled: false }));
    },
  });
  await assert.rejects(
    new NodeFileBridgeAdapter({ root: fixture.root, fileSystem: disablingFileSystem }).openCurrent(),
    (error) => error.code === "connection_unavailable" && error.publication === "not_published",
  );

  await writeFile(fixture.statusPath, JSON.stringify(fixture.status));
  const adapter = new NodeFileBridgeAdapter({ root: fixture.root });
  const session = await adapter.openCurrent(connectionFor(fixture));
  await writeFile(fixture.statusPath, JSON.stringify({
    ...fixture.status,
    sessionId: "abcdef0123456789abcdef0123456789",
  }));
  await assert.rejects(
    adapter.publishRequest(session, searchRequest(fixture, "session-race")),
    (error) => error.code === "connection_changed" && error.publication === "not_published",
  );
});

test("create-only publication converges for identical callers and conflicts for different content", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const adapter = new NodeFileBridgeAdapter({ root: fixture.root });
  const session = await adapter.openCurrent(connectionFor(fixture));
  const request = searchRequest(fixture, "concurrent-1", "same");
  const publications = await Promise.all(
    Array.from({ length: 12 }, () => adapter.publishRequest(session, structuredClone(request))),
  );
  assert.deepEqual(new Set(publications), new Set(["published"]));
  assert.deepEqual(
    JSON.parse(await readFile(path.join(fixture.requestDirectory, "concurrent-1.request.json"), "utf8")),
    request,
  );

  await assert.rejects(
    adapter.publishRequest(session, searchRequest(fixture, "concurrent-1", "different")),
    (error) => error.code === "identity_conflict" && error.publication === "not_published",
  );

  const different = await Promise.allSettled([
    adapter.publishRequest(session, searchRequest(fixture, "concurrent-different", "left")),
    adapter.publishRequest(session, searchRequest(fixture, "concurrent-different", "right")),
  ]);
  assert.equal(different.filter((entry) => entry.status === "fulfilled").length, 1);
  const rejected = different.find((entry) => entry.status === "rejected");
  assert.equal(rejected.reason.code, "identity_conflict");
  assert.equal(rejected.reason.publication, "not_published");
});

test("canonical identical existing requests are observed without replacement", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const adapter = new NodeFileBridgeAdapter({ root: fixture.root });
  const session = await adapter.openCurrent(connectionFor(fixture));
  const request = searchRequest(fixture, "canonical-1");
  const target = path.join(fixture.requestDirectory, "canonical-1.request.json");
  const formatted = `${JSON.stringify(request, null, 2)}\n`;
  await writeFile(target, formatted, { flag: "wx" });
  assert.equal(await adapter.publishRequest(session, request), "published");
  assert.equal(await readFile(target, "utf8"), formatted);
});

test("result reads ignore partial siblings and reject malformed, mismatched, and oversized finals", async (t) => {
  const fixture = await createControlledBridgeFixture(t, { maxResultBytes: 1024 });
  const adapter = new NodeFileBridgeAdapter({ root: fixture.root, pollIntervalMs: 5 });
  const session = await adapter.openCurrent(connectionFor(fixture));
  const request = searchRequest(fixture, "result-1");
  await adapter.publishRequest(session, request);
  await writeFile(
    path.join(fixture.resultDirectory, "result-1.result.json.partial"),
    JSON.stringify(succeeded(request, { matches: [] })),
  );
  await assert.rejects(
    adapter.waitForResult(session, request, { timeoutMs: 25 }),
    (error) => error.code === "wait_expired" && error.publication === "published",
  );

  const finalPath = path.join(fixture.resultDirectory, "result-1.result.json");
  await writeFile(finalPath, "{");
  await assert.rejects(
    adapter.waitForResult(session, request, { timeoutMs: 25 }),
    (error) => error.code === "invalid_result",
  );

  await writeFile(finalPath, "x".repeat(1025));
  await assert.rejects(
    adapter.waitForResult(session, request, { timeoutMs: 25 }),
    (error) => error.code === "result_too_large",
  );

  await unlink(finalPath);
  const outside = path.join(fixture.root, "outside-result.json");
  await writeFile(outside, JSON.stringify(succeeded(request, { matches: [] })));
  await symlink(outside, finalPath);
  await assert.rejects(
    adapter.waitForResult(session, request, { timeoutMs: 25 }),
    (error) => error.code === "access_denied" && error.publication === "published",
  );
});

test("historical fixed-session lookup allows disabled status and never creates files", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  await writeFile(fixture.statusPath, JSON.stringify({ ...fixture.status, enabled: false }));
  const request = searchRequest(fixture, "historical-1");
  const response = succeeded(request, { matches: [] });
  await writeFile(
    path.join(fixture.requestDirectory, "historical-1.request.json"),
    JSON.stringify(request),
  );
  await writeFile(
    path.join(fixture.resultDirectory, "historical-1.result.json"),
    JSON.stringify(response),
  );
  const before = (await Promise.all([
    readFile(path.join(fixture.requestDirectory, "historical-1.request.json"), "utf8"),
    readFile(path.join(fixture.resultDirectory, "historical-1.result.json"), "utf8"),
  ])).join("\n");

  const adapter = new NodeFileBridgeAdapter({ root: fixture.root });
  const session = await adapter.openHistorical(connectionFor(fixture));
  assert.deepEqual(await adapter.readRecordedRequest(session, "historical-1"), request);
  assert.deepEqual(await adapter.readRecordedResult(session, "historical-1"), response);

  const after = (await Promise.all([
    readFile(path.join(fixture.requestDirectory, "historical-1.request.json"), "utf8"),
    readFile(path.join(fixture.resultDirectory, "historical-1.result.json"), "utf8"),
  ])).join("\n");
  assert.equal(after, before);
});
