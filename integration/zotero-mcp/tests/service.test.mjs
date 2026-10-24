import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createNodeZoteroMcpService as createZoteroMcpService } from "../src/node-service.mjs";
import { NodeFileBridgeAdapter, NodeSecureFileSystem } from "../src/node-file-bridge.mjs";
import {
  ACTIVE_OPERATIONS,
  connectionFor,
  connectionStatusData,
  createControlledBridgeFixture,
  defaultNativeResponse,
  startControlledNativeResponder,
  succeeded,
} from "./helpers/controlled-bridge-fixture.mjs";

function searchInput(fixture, operationId = "search-1", query = "Bayesian") {
  return {
    operationId,
    connection: connectionFor(fixture),
    payload: { query, limit: 25 },
  };
}

function writeAuthorization(scope = "Save the exact requested content.") {
  return { kind: "explicit_request", scope };
}

function nonSucceeded(request, state) {
  const errorCodes = {
    rejected: "conflict",
    failed: "storage_error",
    indeterminate: "unknown_outcome",
  };
  return {
    protocolVersion: 1,
    operationId: request.operationId,
    state,
    data: null,
    error: state === "queued" || state === "running"
      ? null
      : {
          code: errorCodes[state],
          message: `Controlled ${state} fixture`,
          retryable: state !== "rejected",
        },
    verification: { storage: "not_checked", viewer: "not_checked" },
  };
}

function annotationAnchor() {
  return {
    libraryId: "1",
    itemKey: "ITEM1",
    attachmentKey: "ATTACH1",
    attachmentFingerprint: "sha256:fixture",
    pageIndex: 2,
    pageLabel: "3",
    rectangles: [{ x1: 1, y1: 2, x2: 10, y2: 12 }],
    selectedText: "정리",
    matchEvidence: { method: "exact_quote", matchedText: "정리", exact: true },
  };
}

function nativeAnnotation(comment = "기존 본문", revision = "rev:9") {
  return {
    annotationKey: "ANN1",
    revision,
    type: "highlight",
    anchor: annotationAnchor(),
    text: "정리",
    comment,
    color: "#ffd400",
    deepLink: "zotero://open-pdf/library/items/ATTACH1?page=3&annotation=ANN1",
  };
}

test("restart bootstrap is a fresh status request and native capability subsets gate publication", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const responder = await startControlledNativeResponder(t, fixture, async (request) =>
    defaultNativeResponse(fixture, request));

  const firstService = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const first = await firstService.callTool("zotero_search_papers", searchInput(fixture, "search-first"));
  assert.equal(first.result.state, "succeeded");
  assert.deepEqual(responder.observed.slice(0, 2).map((request) => request.operation), [
    "connection_status",
    "search_papers",
  ]);

  const restarted = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const second = await restarted.callTool("zotero_search_papers", searchInput(fixture, "search-second"));
  assert.equal(second.result.state, "succeeded");
  assert.deepEqual(responder.observed.slice(2, 4).map((request) => request.operation), [
    "connection_status",
    "search_papers",
  ]);

  const limitedFixture = await createControlledBridgeFixture(t, {
    sessionId: "abcdef0123456789abcdef0123456789",
  });
  const limited = ["connection_status", "read_note"];
  const limitedResponder = await startControlledNativeResponder(t, limitedFixture, async (request) => {
    if (request.operation === "connection_status") {
      return succeeded(request, connectionStatusData(limitedFixture, limited));
    }
    return defaultNativeResponse(limitedFixture, request, limited);
  });
  const limitedService = createZoteroMcpService({
    bridgeRoot: limitedFixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const unavailable = await limitedService.callTool(
    "zotero_search_papers",
    searchInput(limitedFixture, "search-unavailable"),
  );
  assert.equal(unavailable.delivery, "not_published");
  assert.equal(unavailable.error.code, "connection_unavailable");
  assert.deepEqual(limitedResponder.observed.map((request) => request.operation), ["connection_status"]);
});

test("input is snapshotted before awaits and a post-publication timeout keeps known delivery", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const responder = await startControlledNativeResponder(t, fixture, async (request) => {
    if (request.operation === "connection_status") {
      return defaultNativeResponse(fixture, request);
    }
    if (request.operation === "search_papers" && request.operationId === "snapshot-1") {
      return succeeded(request, { matches: [] });
    }
    return undefined;
  });
  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 200,
    pollIntervalMs: 5,
  });
  const input = searchInput(fixture, "snapshot-1", "original");
  const pending = service.callTool("zotero_search_papers", input);
  input.payload.query = "mutated after invocation";
  const result = await pending;
  assert.equal(result.result.state, "succeeded");
  assert.equal(
    responder.observed.find((request) => request.operationId === "snapshot-1").payload.query,
    "original",
  );

  const timeout = await service.callTool(
    "zotero_search_papers",
    searchInput(fixture, "timeout-after-publish"),
  );
  assert.equal(timeout.delivery, "published");
  assert.equal(timeout.result, null);
  assert.equal(timeout.error.code, "wait_expired");
});

test("disabled sessions and known request oversize fail before publishing the invocation", async (t) => {
  const disabled = await createControlledBridgeFixture(t, { enabled: false });
  const disabledService = createZoteroMcpService({ bridgeRoot: disabled.root });
  const unavailable = await disabledService.callTool(
    "zotero_search_papers",
    searchInput(disabled, "disabled-1"),
  );
  assert.equal(unavailable.delivery, "not_published");
  assert.equal(unavailable.error.code, "connection_unavailable");
  assert.deepEqual(await readdir(disabled.requestDirectory), []);

  const limited = await createControlledBridgeFixture(t, { maxRequestBytes: 420 });
  const limitedResponder = await startControlledNativeResponder(t, limited, async (request) =>
    defaultNativeResponse(limited, request));
  const limitedService = createZoteroMcpService({
    bridgeRoot: limited.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const tooLarge = await limitedService.callTool(
    "zotero_search_papers",
    searchInput(limited, "oversize-1", "가".repeat(300)),
  );
  assert.equal(tooLarge.delivery, "not_published");
  assert.equal(tooLarge.error.code, "invalid_input");
  assert.deepEqual(limitedResponder.observed.map((request) => request.operation), ["connection_status"]);
});

test("advertised native text limits reject known complete bodies before mutation publication", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const responder = await startControlledNativeResponder(t, fixture, async (request) => {
    if (request.operation !== "connection_status") {
      return undefined;
    }
    const status = connectionStatusData(fixture);
    return succeeded(request, {
      ...status,
      capabilities: { ...status.capabilities, maxTextBytes: 8 },
    });
  });
  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const result = await service.callTool("zotero_create_annotation", {
    operationId: "native-text-limit",
    connection: connectionFor(fixture),
    authorization: writeAuthorization(),
    payload: {
      anchor: annotationAnchor(),
      type: "highlight",
      comment: "한글 본문은 제한보다 큽니다",
      color: "#ffd400",
    },
  });
  assert.equal(result.delivery, "not_published");
  assert.equal(result.error.code, "invalid_input");
  assert.deepEqual(responder.observed.map((request) => request.operation), ["connection_status"]);
});

test("semantic response mismatches return invalid_result without exposing the mismatched body", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  await startControlledNativeResponder(t, fixture, async (request) => {
    if (request.operation === "connection_status") return defaultNativeResponse(fixture, request);
    if (request.operation === "read_note") {
      return succeeded(request, {
        parentItemKey: "OTHER",
        noteKey: "SECRET-WRONG-KEY",
        revision: "rev:1",
        content: "private mismatched content",
        deepLink: "zotero://select/library/items/SECRET-WRONG-KEY",
      });
    }
    return undefined;
  });
  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const result = await service.callTool("zotero_read_note", {
    operationId: "wrong-note-result",
    connection: connectionFor(fixture),
    payload: { libraryId: "1", itemKey: "ITEM1", noteKey: "NOTE1" },
  });
  assert.equal(result.delivery, "published");
  assert.equal(result.error.code, "invalid_result");
  assert.doesNotMatch(JSON.stringify(result), /SECRET|private mismatched/u);
});

test("write success requires storage confirmation but preserves viewer failure", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  await startControlledNativeResponder(t, fixture, async (request) => {
    if (request.operation === "connection_status") return defaultNativeResponse(fixture, request);
    if (request.operation !== "create_note") return undefined;
    return succeeded(request, {
      noteKey: request.operationId === "storage-unconfirmed" ? "NOTE-BAD" : "NOTE-GOOD",
      revision: "rev:1",
      content: request.payload.content,
      deepLink: "zotero://select/library/items/NOTE1",
    }, request.operationId === "storage-unconfirmed"
      ? { storage: "failed", viewer: "confirmed" }
      : { storage: "confirmed", viewer: "failed" });
  });
  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  t.after(() => service.close());
  const common = {
    connection: connectionFor(fixture),
    authorization: writeAuthorization(),
    payload: { libraryId: "1", itemKey: "ITEM1", content: "complete body" },
  };

  const unconfirmed = await service.callTool("zotero_create_note", {
    ...common,
    operationId: "storage-unconfirmed",
  });
  assert.equal(unconfirmed.delivery, "published");
  assert.equal(unconfirmed.result, null);
  assert.equal(unconfirmed.error.code, "invalid_result");

  const viewerFailed = await service.callTool("zotero_create_note", {
    ...common,
    operationId: "viewer-failed-after-storage-confirmed",
  });
  assert.equal(viewerFailed.delivery, "published");
  assert.equal(viewerFailed.result.state, "succeeded");
  assert.deepEqual(viewerFailed.result.verification, {
    storage: "confirmed",
    viewer: "failed",
  });
});

test("annotation append retains preflight evidence and validates complete Unicode readback", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const prior = "기존 본문 é";
  const addition = "추가 설명 🧪";
  const complete = `${prior}\n\n${addition}`;
  const responder = await startControlledNativeResponder(t, fixture, async (request) => {
    if (request.operation === "connection_status") return defaultNativeResponse(fixture, request);
    if (request.operation === "list_annotations") {
      return succeeded(request, { annotations: [nativeAnnotation(prior)] });
    }
    if (request.operation === "update_annotation") {
      return succeeded(request, {
        annotationKey: "ANN1",
        revision: "rev:10",
        comment: complete,
        deepLink: "zotero://open-pdf/library/items/ATTACH1?page=3&annotation=ANN1",
      });
    }
    return undefined;
  });
  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const result = await service.callTool("zotero_update_annotation", {
    operationId: "append-annotation-unicode",
    connection: connectionFor(fixture),
    authorization: writeAuthorization("Append the approved Korean detail to ANN1 at rev:9."),
    payload: {
      libraryId: "1",
      attachmentKey: "ATTACH1",
      annotationKey: "ANN1",
      expectedRevision: "rev:9",
      mode: "append",
      comment: addition,
    },
  });
  assert.equal(result.result.state, "succeeded");
  assert.equal(result.result.data.comment, complete);
  assert.deepEqual(responder.observed.map((request) => request.operation), [
    "connection_status",
    "list_annotations",
    "update_annotation",
  ]);
  assert.match(responder.observed[1].operationId, /^mcp\.preflight\./u);
});

test("annotation create and replace compare the complete prepared Unicode body", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const createBody = "새 주석 본문 é 🧪";
  const replaceBody = "교체한 전체 본문 한글";
  await startControlledNativeResponder(t, fixture, async (request) => {
    if (request.operation === "connection_status") return defaultNativeResponse(fixture, request);
    if (request.operation === "create_annotation") {
      return succeeded(request, {
        annotationKey: "ANN-CREATED",
        revision: "rev:1",
        deepLink: "zotero://open-pdf/library/items/ATTACH1?page=3&annotation=ANN-CREATED",
        saved: {
          pageIndex: request.payload.anchor.pageIndex,
          pageLabel: request.payload.anchor.pageLabel,
          rectangles: request.payload.anchor.rectangles,
          selectedText: request.payload.anchor.selectedText,
          comment: createBody,
        },
      });
    }
    if (request.operation === "update_annotation") {
      return succeeded(request, {
        annotationKey: request.payload.annotationKey,
        revision: "rev:10",
        comment: replaceBody,
        deepLink: "zotero://open-pdf/library/items/ATTACH1?page=3&annotation=ANN1",
      });
    }
    return undefined;
  });
  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const created = await service.callTool("zotero_create_annotation", {
    operationId: "create-annotation-unicode",
    connection: connectionFor(fixture),
    authorization: writeAuthorization(),
    payload: {
      anchor: annotationAnchor(),
      type: "highlight",
      comment: createBody,
      color: "#ffd400",
    },
  });
  assert.equal(created.result.data.saved.comment, createBody);

  const replaced = await service.callTool("zotero_update_annotation", {
    operationId: "replace-annotation-unicode",
    connection: connectionFor(fixture),
    authorization: writeAuthorization(),
    payload: {
      libraryId: "1",
      attachmentKey: "ATTACH1",
      annotationKey: "ANN1",
      expectedRevision: "rev:9",
      mode: "replace",
      comment: replaceBody,
    },
  });
  assert.equal(replaced.result.data.comment, replaceBody);
});

test("stale append preflight and unrepresentable annotation bodies never publish a mutation", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const responder = await startControlledNativeResponder(t, fixture, async (request) => {
    if (request.operation === "connection_status") return defaultNativeResponse(fixture, request);
    if (request.operation === "list_annotations") {
      return succeeded(request, { annotations: [nativeAnnotation("current", "rev:changed")] });
    }
    throw new Error("A controlled fixture mutation must not be published");
  });
  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const stale = await service.callTool("zotero_update_annotation", {
    operationId: "append-stale",
    connection: connectionFor(fixture),
    authorization: writeAuthorization(),
    payload: {
      libraryId: "1",
      attachmentKey: "ATTACH1",
      annotationKey: "ANN1",
      expectedRevision: "rev:9",
      mode: "append",
      comment: "addition",
    },
  });
  assert.equal(stale.delivery, "not_published");
  assert.equal(stale.error.code, "invalid_input");

  const invalid = await service.callTool("zotero_create_annotation", {
    operationId: "annotation-whitespace",
    connection: connectionFor(fixture),
    authorization: writeAuthorization(),
    payload: {
      anchor: annotationAnchor(),
      type: "highlight",
      comment: " trailing whitespace ",
      color: "#ffd400",
    },
  });
  assert.equal(invalid.delivery, "not_published");
  assert.equal(invalid.error.code, "invalid_input");
  assert.deepEqual(responder.observed.map((request) => request.operation), [
    "connection_status",
    "list_annotations",
  ]);
});

test("note create, replace, and append compare the complete safe prepared body", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const responder = await startControlledNativeResponder(t, fixture, async (request) => {
    if (request.operation === "connection_status") return defaultNativeResponse(fixture, request);
    if (request.operation === "read_note") {
      return succeeded(request, {
        parentItemKey: "ITEM1",
        noteKey: "NOTE1",
        revision: "rev:9",
        content: "<p>기존 안전 본문</p>",
        deepLink: "zotero://select/library/items/NOTE1",
      });
    }
    if (request.operation === "create_note") {
      return succeeded(request, {
        noteKey: "CREATED1",
        revision: "rev:1",
        content: request.payload.content,
        deepLink: "zotero://select/library/items/CREATED1",
      });
    }
    if (request.operation === "update_note" && request.payload.mode === "replace") {
      return succeeded(request, {
        noteKey: "NOTE1",
        revision: "rev:10",
        content: request.payload.content,
        deepLink: "zotero://select/library/items/NOTE1",
      });
    }
    if (request.operation === "update_note") {
      return succeeded(request, {
        noteKey: "NOTE1",
        revision: "rev:10",
        content: "<p>기존 안전 본문</p>\n\n새 질문 🧪",
        deepLink: "zotero://select/library/items/NOTE1",
      });
    }
    return undefined;
  });
  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  const common = { connection: connectionFor(fixture), authorization: writeAuthorization() };
  const created = await service.callTool("zotero_create_note", {
    ...common,
    operationId: "create-note-unicode",
    payload: { libraryId: "1", itemKey: "ITEM1", content: "새 노트 🧪" },
  });
  assert.equal(created.result.state, "succeeded");

  const replaced = await service.callTool("zotero_update_note", {
    ...common,
    operationId: "replace-note-unicode",
    payload: {
      libraryId: "1",
      itemKey: "ITEM1",
      noteKey: "NOTE1",
      expectedRevision: "rev:9",
      mode: "replace",
      content: "교체 본문 🧪",
    },
  });
  assert.equal(replaced.result.state, "succeeded");

  const appended = await service.callTool("zotero_update_note", {
    ...common,
    operationId: "append-note-unicode",
    payload: {
      libraryId: "1",
      itemKey: "ITEM1",
      noteKey: "NOTE1",
      expectedRevision: "rev:9",
      mode: "append",
      content: "새 질문 🧪",
    },
  });
  assert.equal(appended.result.state, "succeeded");
});

test("disabled historical lookup is observation-only and missing append evidence stays unresolved", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  await writeFile(fixture.statusPath, JSON.stringify({ ...fixture.status, enabled: false }));
  const request = {
    protocolVersion: 1,
    operationId: "historical-note",
    operation: "read_note",
    profileId: fixture.profileId,
    payload: { libraryId: "1", itemKey: "ITEM1", noteKey: "NOTE1" },
  };
  const result = succeeded(request, {
    parentItemKey: "ITEM1",
    noteKey: "NOTE1",
    revision: "rev:1",
    content: "Retained history",
    deepLink: "zotero://select/library/items/NOTE1",
  });
  await writeFile(
    path.join(fixture.requestDirectory, "historical-note.request.json"),
    JSON.stringify(request),
  );
  await writeFile(
    path.join(fixture.resultDirectory, "historical-note.result.json"),
    JSON.stringify(result),
  );
  const service = createZoteroMcpService({ bridgeRoot: fixture.root });
  const before = (await readdir(fixture.requestDirectory)).sort();
  const observed = await service.callTool("zotero_get_operation_result", {
    operationId: "historical-note",
    connection: connectionFor(fixture),
  });
  assert.equal(observed.result.state, "succeeded");
  assert.deepEqual((await readdir(fixture.requestDirectory)).sort(), before);

  const appendRequest = {
    protocolVersion: 1,
    operationId: "historical-append",
    operation: "update_note",
    profileId: fixture.profileId,
    authorization: writeAuthorization(),
    payload: {
      libraryId: "1",
      itemKey: "ITEM1",
      noteKey: "NOTE1",
      expectedRevision: "rev:9",
      mode: "append",
      content: "addition",
    },
  };
  const appendResult = succeeded(appendRequest, {
    noteKey: "NOTE1",
    revision: "rev:10",
    content: "Existing\n\naddition",
    deepLink: "zotero://select/library/items/NOTE1",
  });
  await writeFile(
    path.join(fixture.requestDirectory, "historical-append.request.json"),
    JSON.stringify(appendRequest),
  );
  await writeFile(
    path.join(fixture.resultDirectory, "historical-append.result.json"),
    JSON.stringify(appendResult),
  );
  const unresolved = await service.callTool("zotero_get_operation_result", {
    operationId: "historical-append",
    connection: connectionFor(fixture),
  });
  assert.equal(unresolved.delivery, "published");
  assert.equal(unresolved.result, null);
  assert.equal(unresolved.error.code, "invalid_result");
  assert.deepEqual((await readdir(fixture.requestDirectory)).sort(), [
    "historical-append.request.json",
    "historical-note.request.json",
  ]);
});

test("write lifecycle results before success do not require MCP complete-body evidence", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const states = ["queued", "running", "rejected", "failed", "indeterminate"];
  const appendRequests = new Map();

  for (const state of states) {
    const operationId = `legacy-append-${state}`;
    const request = {
      protocolVersion: 1,
      operationId,
      operation: "update_note",
      profileId: fixture.profileId,
      authorization: writeAuthorization(),
      payload: {
        libraryId: "1",
        itemKey: "ITEM1",
        noteKey: "NOTE1",
        expectedRevision: "rev:9",
        mode: "append",
        content: "approved addition",
      },
    };
    appendRequests.set(state, request);
    await writeFile(
      path.join(fixture.requestDirectory, `${operationId}.request.json`),
      JSON.stringify(request),
    );
    await writeFile(
      path.join(fixture.resultDirectory, `${operationId}.result.json`),
      JSON.stringify(nonSucceeded(request, state)),
    );
  }

  const succeededAppendRequest = {
    ...structuredClone(appendRequests.get("rejected")),
    operationId: "legacy-append-succeeded-without-evidence",
  };
  await writeFile(
    path.join(fixture.requestDirectory, `${succeededAppendRequest.operationId}.request.json`),
    JSON.stringify(succeededAppendRequest),
  );
  await writeFile(
    path.join(fixture.resultDirectory, `${succeededAppendRequest.operationId}.result.json`),
    JSON.stringify(succeeded(succeededAppendRequest, {
      noteKey: "NOTE1",
      revision: "rev:10",
      content: "Existing body\n\napproved addition",
      deepLink: "zotero://select/library/items/NOTE1",
    })),
  );

  const invalidAnnotationRequest = {
    protocolVersion: 1,
    operationId: "legacy-invalid-annotation-rejected",
    operation: "create_annotation",
    profileId: fixture.profileId,
    authorization: writeAuthorization(),
    payload: {
      anchor: annotationAnchor(),
      type: "highlight",
      comment: " trailing body ",
      color: "#ffd400",
    },
  };
  await writeFile(
    path.join(fixture.requestDirectory, `${invalidAnnotationRequest.operationId}.request.json`),
    JSON.stringify(invalidAnnotationRequest),
  );
  await writeFile(
    path.join(fixture.resultDirectory, `${invalidAnnotationRequest.operationId}.result.json`),
    JSON.stringify(nonSucceeded(invalidAnnotationRequest, "rejected")),
  );

  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  t.after(() => service.close());

  for (const [state, request] of appendRequests) {
    const observed = await service.callTool("zotero_get_operation_result", {
      operationId: request.operationId,
      connection: connectionFor(fixture),
    });
    assert.equal(observed.delivery, "published");
    assert.equal(observed.result.state, state);
    assert.equal(observed.error, null);
  }

  const responder = await startControlledNativeResponder(t, fixture, async (request) => {
    if (request.operation === "connection_status") return defaultNativeResponse(fixture, request);
    return undefined;
  });
  const rejectedAppendRequest = appendRequests.get("rejected");
  const directAppend = await service.callTool("zotero_update_note", {
    operationId: rejectedAppendRequest.operationId,
    connection: connectionFor(fixture),
    authorization: rejectedAppendRequest.authorization,
    payload: rejectedAppendRequest.payload,
  });
  assert.equal(directAppend.delivery, "published");
  assert.equal(directAppend.result.state, "rejected");

  const unresolvedDirectSuccess = await service.callTool("zotero_update_note", {
    operationId: succeededAppendRequest.operationId,
    connection: connectionFor(fixture),
    authorization: succeededAppendRequest.authorization,
    payload: succeededAppendRequest.payload,
  });
  assert.equal(unresolvedDirectSuccess.delivery, "published");
  assert.equal(unresolvedDirectSuccess.result, null);
  assert.equal(unresolvedDirectSuccess.error.code, "invalid_result");

  const unresolvedHistoricalSuccess = await service.callTool("zotero_get_operation_result", {
    operationId: succeededAppendRequest.operationId,
    connection: connectionFor(fixture),
  });
  assert.equal(unresolvedHistoricalSuccess.delivery, "published");
  assert.equal(unresolvedHistoricalSuccess.result, null);
  assert.equal(unresolvedHistoricalSuccess.error.code, "invalid_result");

  const directInvalid = await service.callTool("zotero_create_annotation", {
    operationId: invalidAnnotationRequest.operationId,
    connection: connectionFor(fixture),
    authorization: invalidAnnotationRequest.authorization,
    payload: invalidAnnotationRequest.payload,
  });
  assert.equal(directInvalid.delivery, "published");
  assert.equal(directInvalid.result.state, "rejected");

  const historicalInvalid = await service.callTool("zotero_get_operation_result", {
    operationId: invalidAnnotationRequest.operationId,
    connection: connectionFor(fixture),
  });
  assert.equal(historicalInvalid.result.state, "rejected");
  assert.equal(
    responder.observed.some((request) => request.operationId.startsWith("mcp.preflight.")),
    false,
  );
});

test("the absolute invocation deadline fences final publication and late result reads", async (t) => {
  const publicationFixture = await createControlledBridgeFixture(t);
  const publicationStatusRequest = {
    protocolVersion: 1,
    operationId: "deadline-publication-status",
    operation: "connection_status",
    payload: {},
  };
  await writeFile(
    path.join(publicationFixture.requestDirectory, `${publicationStatusRequest.operationId}.request.json`),
    JSON.stringify(publicationStatusRequest),
  );
  await writeFile(
    path.join(publicationFixture.resultDirectory, `${publicationStatusRequest.operationId}.result.json`),
    JSON.stringify(succeeded(
      publicationStatusRequest,
      connectionStatusData(publicationFixture),
    )),
  );

  let armPublicationDelay = false;
  let delayedPublicationFence = false;
  const descriptorPath = path.join(publicationFixture.root, "bridge-v1.json");
  const lateRequestName = "deadline-late-publication.request.json";
  const publicationFileSystem = new NodeSecureFileSystem({
    afterRead: async (filename) => {
      if (!armPublicationDelay || delayedPublicationFence || filename !== descriptorPath) return;
      const names = await readdir(publicationFixture.requestDirectory);
      if (!names.some((name) => name.startsWith(`${lateRequestName}.partial.`))) return;
      delayedPublicationFence = true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    },
  });
  const publicationService = createZoteroMcpService({
    bridgeRoot: publicationFixture.root,
    adapter: new NodeFileBridgeAdapter({
      root: publicationFixture.root,
      fileSystem: publicationFileSystem,
      pollIntervalMs: 5,
    }),
    waitTimeoutMs: 40,
  });
  t.after(() => publicationService.close());
  const warmedPublication = await publicationService.callTool("zotero_connection_status", {
    operationId: publicationStatusRequest.operationId,
  });
  assert.equal(warmedPublication.result.state, "succeeded");

  armPublicationDelay = true;
  const latePublication = await publicationService.callTool(
    "zotero_search_papers",
    searchInput(publicationFixture, "deadline-late-publication"),
  );
  assert.equal(delayedPublicationFence, true);
  assert.equal(latePublication.delivery, "not_published");
  assert.equal(latePublication.error.code, "wait_expired");
  await new Promise((resolve) => setTimeout(resolve, 175));
  assert.equal((await readdir(publicationFixture.requestDirectory)).includes(lateRequestName), false);

  const resultFixture = await createControlledBridgeFixture(t, {
    sessionId: "abcdef0123456789abcdef0123456789",
  });
  const resultStatusRequest = {
    protocolVersion: 1,
    operationId: "deadline-result-status",
    operation: "connection_status",
    payload: {},
  };
  const resultRequest = {
    protocolVersion: 1,
    operationId: "deadline-late-result",
    operation: "search_papers",
    profileId: resultFixture.profileId,
    payload: { query: "Bayesian", limit: 25 },
  };
  for (const [request, result] of [
    [resultStatusRequest, succeeded(resultStatusRequest, connectionStatusData(resultFixture))],
    [resultRequest, succeeded(resultRequest, { matches: [] })],
  ]) {
    await writeFile(
      path.join(resultFixture.requestDirectory, `${request.operationId}.request.json`),
      JSON.stringify(request),
    );
    await writeFile(
      path.join(resultFixture.resultDirectory, `${request.operationId}.result.json`),
      JSON.stringify(result),
    );
  }
  let armResultDelay = false;
  let delayedResultRead = false;
  const lateResultPath = path.join(
    resultFixture.resultDirectory,
    `${resultRequest.operationId}.result.json`,
  );
  const resultFileSystem = new NodeSecureFileSystem({
    afterRead: async (filename) => {
      if (!armResultDelay || delayedResultRead || filename !== lateResultPath) return;
      delayedResultRead = true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    },
  });
  const resultService = createZoteroMcpService({
    bridgeRoot: resultFixture.root,
    adapter: new NodeFileBridgeAdapter({
      root: resultFixture.root,
      fileSystem: resultFileSystem,
      pollIntervalMs: 5,
    }),
    waitTimeoutMs: 40,
  });
  t.after(() => resultService.close());
  const warmedResult = await resultService.callTool("zotero_connection_status", {
    operationId: resultStatusRequest.operationId,
  });
  assert.equal(warmedResult.result.state, "succeeded");

  armResultDelay = true;
  const lateResult = await resultService.callTool(
    "zotero_search_papers",
    searchInput(resultFixture, resultRequest.operationId),
  );
  assert.equal(delayedResultRead, true);
  assert.equal(lateResult.delivery, "published");
  assert.equal(lateResult.result, null);
  assert.equal(lateResult.error.code, "wait_expired");

  delayedResultRead = false;
  const beforeLookup = (await readdir(resultFixture.requestDirectory)).sort();
  const lateLookup = await resultService.callTool("zotero_get_operation_result", {
    operationId: resultRequest.operationId,
    connection: connectionFor(resultFixture),
  });
  assert.equal(delayedResultRead, true);
  assert.equal(lateLookup.delivery, "published");
  assert.equal(lateLookup.result, null);
  assert.equal(lateLookup.error.code, "wait_expired");
  assert.deepEqual((await readdir(resultFixture.requestDirectory)).sort(), beforeLookup);
});

test("one invocation deadline is shared by capability bootstrap and the requested operation", async (t) => {
  const fixture = {
    profileId: "profile-A",
    sessionId: "0123456789abcdef0123456789abcdef",
  };
  const session = {
    kind: "current",
    connection: connectionFor(fixture),
    descriptorIdentity: "fixture-descriptor",
    descriptorBytes: new TextEncoder().encode("fixture-descriptor"),
    maxRequestBytes: 1_048_576,
  };
  const timeouts = [];
  const adapter = {
    async openCurrent() {
      return session;
    },
    async inspectRequest() {
      return { state: "absent" };
    },
    async publishRequest() {
      return "published";
    },
    async waitForResult(_session, request, options) {
      timeouts.push(options.timeoutMs);
      if (request.operation === "connection_status") {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return succeeded(request, connectionStatusData(fixture));
      }
      return succeeded(request, { matches: [] });
    },
  };
  const service = createZoteroMcpService({
    bridgeRoot: "/unused-controlled-adapter",
    adapter,
    waitTimeoutMs: 100,
  });
  t.after(() => service.close());

  const result = await service.callTool("zotero_search_papers", searchInput(fixture, "one-deadline"));
  assert.equal(result.result.state, "succeeded");
  assert.equal(timeouts.length, 2);
  assert.ok(timeouts[0] <= 100 && timeouts[0] >= 90);
  assert.ok(timeouts[1] < 90, `second wait received a fresh ${timeouts[1]}ms timeout`);
});

test("internal bootstrap and append preflight publication never grants published delivery to the outer operation", async (t) => {
  const bootstrapFixture = await createControlledBridgeFixture(t);
  const bootstrapResponder = await startControlledNativeResponder(
    t,
    bootstrapFixture,
    async () => undefined,
  );
  const bootstrapService = createZoteroMcpService({
    bridgeRoot: bootstrapFixture.root,
    waitTimeoutMs: 150,
    pollIntervalMs: 5,
  });
  const bootstrapFailure = await bootstrapService.callTool(
    "zotero_search_papers",
    searchInput(bootstrapFixture, "outer-after-bootstrap-timeout"),
  );
  assert.equal(bootstrapFailure.delivery, "not_published");
  assert.deepEqual(bootstrapResponder.observed.map((request) => request.operation), [
    "connection_status",
  ]);

  const appendFixture = await createControlledBridgeFixture(t, {
    sessionId: "abcdef0123456789abcdef0123456789",
  });
  const appendResponder = await startControlledNativeResponder(t, appendFixture, async (request) => {
    if (request.operation === "connection_status") return defaultNativeResponse(appendFixture, request);
    return undefined;
  });
  const appendService = createZoteroMcpService({
    bridgeRoot: appendFixture.root,
    waitTimeoutMs: 150,
    pollIntervalMs: 5,
  });
  const appendFailure = await appendService.callTool("zotero_update_annotation", {
    operationId: "outer-after-preflight-timeout",
    connection: connectionFor(appendFixture),
    authorization: writeAuthorization(),
    payload: {
      libraryId: "1",
      attachmentKey: "ATTACH1",
      annotationKey: "ANN1",
      expectedRevision: "rev:9",
      mode: "append",
      comment: "addition",
    },
  });
  assert.equal(appendFailure.delivery, "not_published");
  assert.deepEqual(appendResponder.observed.map((request) => request.operation), [
    "connection_status",
    "list_annotations",
  ]);
});

test("ambiguous outer publication I/O is reported as unconfirmed", async (t) => {
  const fixture = {
    profileId: "profile-A",
    sessionId: "0123456789abcdef0123456789abcdef",
  };
  const service = createZoteroMcpService({
    bridgeRoot: "/unused-controlled-adapter",
    adapter: {
      async openCurrent() {
        return {
          connection: connectionFor(fixture),
          descriptorIdentity: "fixture-descriptor",
          descriptorBytes: new Uint8Array(),
          maxRequestBytes: 1_048_576,
        };
      },
      async publishRequest() {
        throw new Error("controlled ambiguous filesystem failure with private detail");
      },
    },
    waitTimeoutMs: 100,
  });
  t.after(() => service.close());

  const result = await service.callTool("zotero_connection_status", {
    operationId: "ambiguous-outer-publication",
  });
  assert.equal(result.delivery, "unconfirmed");
  assert.equal(result.error.code, "io_error");
  assert.doesNotMatch(JSON.stringify(result), /private detail/u);
});

test("historical lookup is confined to the profile in the current descriptor without publishing", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const request = searchInput(fixture, "old-profile-history");
  const protocolRequest = {
    protocolVersion: 1,
    operationId: request.operationId,
    operation: "search_papers",
    profileId: fixture.profileId,
    payload: request.payload,
  };
  await writeFile(
    path.join(fixture.requestDirectory, "old-profile-history.request.json"),
    JSON.stringify(protocolRequest),
  );
  await writeFile(
    path.join(fixture.resultDirectory, "old-profile-history.result.json"),
    JSON.stringify(succeeded(protocolRequest, { matches: [] })),
  );

  const currentSessionId = "abcdef0123456789abcdef0123456789";
  const currentSessionDirectory = path.join(fixture.root, "sessions", currentSessionId);
  await mkdir(path.join(currentSessionDirectory, "requests"), { recursive: true });
  await mkdir(path.join(currentSessionDirectory, "results"));
  const currentDescriptor = {
    ...fixture.descriptor,
    profileId: "profile-B",
    sessionId: currentSessionId,
    requestDirectory: `sessions/${currentSessionId}/requests`,
    resultDirectory: `sessions/${currentSessionId}/results`,
    statusFile: `sessions/${currentSessionId}/status-v1.json`,
  };
  await writeFile(
    path.join(currentSessionDirectory, "status-v1.json"),
    JSON.stringify({
      ...fixture.status,
      profileId: "profile-B",
      sessionId: currentSessionId,
      enabled: false,
    }),
  );
  await writeFile(path.join(fixture.root, "bridge-v1.json"), JSON.stringify(currentDescriptor));

  const before = (await readdir(fixture.requestDirectory)).sort();
  const service = createZoteroMcpService({ bridgeRoot: fixture.root });
  const result = await service.callTool("zotero_get_operation_result", {
    operationId: "old-profile-history",
    connection: connectionFor(fixture),
  });
  assert.equal(result.delivery, "unconfirmed");
  assert.equal(result.result, null);
  assert.deepEqual((await readdir(fixture.requestDirectory)).sort(), before);
});

test("historical lookup rechecks the configured profile after reading result bytes", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  const request = {
    protocolVersion: 1,
    operationId: "profile-race-history",
    operation: "search_papers",
    profileId: fixture.profileId,
    payload: { query: "retained", limit: 25 },
  };
  const requestPath = path.join(fixture.requestDirectory, "profile-race-history.request.json");
  const resultPath = path.join(fixture.resultDirectory, "profile-race-history.result.json");
  await writeFile(requestPath, JSON.stringify(request));
  await writeFile(resultPath, JSON.stringify(succeeded(request, { matches: [] })));

  const nextSessionId = "abcdef0123456789abcdef0123456789";
  const nextSessionDirectory = path.join(fixture.root, "sessions", nextSessionId);
  await mkdir(path.join(nextSessionDirectory, "requests"), { recursive: true });
  await mkdir(path.join(nextSessionDirectory, "results"));
  const nextDescriptor = {
    ...fixture.descriptor,
    profileId: "profile-B",
    sessionId: nextSessionId,
    requestDirectory: `sessions/${nextSessionId}/requests`,
    resultDirectory: `sessions/${nextSessionId}/results`,
    statusFile: `sessions/${nextSessionId}/status-v1.json`,
  };
  await writeFile(path.join(nextSessionDirectory, "status-v1.json"), JSON.stringify({
    ...fixture.status,
    profileId: "profile-B",
    sessionId: nextSessionId,
    enabled: true,
  }));

  let switched = false;
  const fileSystem = new NodeSecureFileSystem({
    afterRead: async (filename) => {
      if (filename !== resultPath || switched) return;
      switched = true;
      await writeFile(path.join(fixture.root, "bridge-v1.json"), JSON.stringify(nextDescriptor));
    },
  });
  const service = createZoteroMcpService({
    bridgeRoot: fixture.root,
    adapter: new NodeFileBridgeAdapter({ root: fixture.root, fileSystem }),
  });
  const observed = await service.callTool("zotero_get_operation_result", {
    operationId: request.operationId,
    connection: connectionFor(fixture),
  });
  assert.equal(observed.delivery, "unconfirmed");
  assert.equal(observed.error.code, "connection_changed");
  assert.equal(observed.result, null);
  assert.doesNotMatch(JSON.stringify(observed), /retained/u);
});
