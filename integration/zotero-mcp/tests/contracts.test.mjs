import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  ACTIVE_PROTOCOL_OPERATIONS,
  NATIVE_WRITE_OPERATIONS,
  WRAPPER_ERROR_CODES,
  ZOTERO_MCP_TOOL_BY_NAME,
  ZOTERO_MCP_TOOLS,
  prepareZoteroMcpToolCall,
  validateZoteroMcpResult,
} from "../contracts.mjs";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/", import.meta.url));
const PROJECT_ROOT = path.resolve(FIXTURE_ROOT, "../../../..");
const REQUEST_SCHEMA_FILE = path.join(
  PROJECT_ROOT,
  "scripts/package/assets/protocol/v1-request.schema.json",
);
const RESPONSE_SCHEMA_FILE = path.join(
  PROJECT_ROOT,
  "scripts/package/assets/protocol/v1-response.schema.json",
);

async function json(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

const [
  callsFixture,
  resultsFixture,
  protocolRequestSchema,
  protocolResponseSchema,
] = await Promise.all([
  json(path.join(FIXTURE_ROOT, "tool-calls.json")),
  json(path.join(FIXTURE_ROOT, "tool-results.json")),
  json(REQUEST_SCHEMA_FILE),
  json(RESPONSE_SCHEMA_FILE),
]);

const callsByTool = new Map(callsFixture.calls.map((entry) => [entry.tool, entry]));
const resultsByTool = new Map(
  resultsFixture.successful.map((entry) => [entry.tool, entry.result]),
);

const EXPECTED_OPERATIONS = [
  "connection_status",
  "find_local_arxiv",
  "search_papers",
  "read_pdf",
  "list_annotations",
  "list_notes",
  "read_note",
  "resolve_anchor",
  "create_annotation",
  "update_annotation",
  "create_note",
  "update_note",
  "verify_annotation",
];

const EXPECTED_TOOLS = [
  ...EXPECTED_OPERATIONS.map((operation) => `zotero_${operation}`),
  "zotero_get_operation_result",
];

const WRITES = new Set([
  "zotero_create_annotation",
  "zotero_update_annotation",
  "zotero_create_note",
  "zotero_update_note",
]);

const DESTRUCTIVE = new Set([
  "zotero_update_annotation",
  "zotero_update_note",
]);

const PAYLOAD_DEFINITION = {
  find_local_arxiv: "findLocalArxivPayload",
  search_papers: "searchPapersPayload",
  read_pdf: "readPdfPayload",
  list_annotations: "listAnnotationsPayload",
  list_notes: "listNotesPayload",
  read_note: "readNotePayload",
  resolve_anchor: "resolveAnchorPayload",
  create_annotation: "createAnnotationPayload",
  update_annotation: "updateAnnotationPayload",
  create_note: "createNotePayload",
  update_note: "updateNotePayload",
  verify_annotation: "verifyAnnotationPayload",
};

function schemaValidator(schema) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
  });
  addFormats(ajv);
  ajv.addKeyword({
    keyword: "x-maxUtf8Bytes",
    type: "string",
    schemaType: "number",
    validate: (maximum, value) => Buffer.byteLength(value, "utf8") <= maximum,
  });
  return ajv.compile(schema);
}

const schemaValidators = new Map(
  ZOTERO_MCP_TOOLS.map((tool) => [
    tool.name,
    {
      input: schemaValidator(tool.inputSchema),
      output: schemaValidator(tool.outputSchema),
    },
  ]),
);

function validatorsFor(toolName) {
  const validators = schemaValidators.get(toolName);
  assert.ok(validators, `missing schemas for ${toolName}`);
  return validators;
}

function callFor(toolName) {
  const fixture = callsByTool.get(toolName);
  assert.ok(fixture, `missing call fixture for ${toolName}`);
  return fixture;
}

function currentContext(toolName, publication = "observed_published") {
  const fixture = callFor(toolName);
  return { toolName, input: fixture.input, publication };
}

function lookupContext(publication, recordedTool = callsFixture.lookup.recordedTool) {
  const recorded = prepareZoteroMcpToolCall(
    recordedTool,
    callFor(recordedTool).input,
  );
  assert.equal(recorded.kind, "operation");
  return {
    toolName: callsFixture.lookup.tool,
    input: callsFixture.lookup.input,
    publication,
    recordedRequest: recorded.request,
  };
}

test("inventory exposes only the thirteen active protocol operations and lookup", () => {
  assert.deepEqual(ACTIVE_PROTOCOL_OPERATIONS, EXPECTED_OPERATIONS);
  assert.deepEqual(NATIVE_WRITE_OPERATIONS, [
    "create_annotation",
    "update_annotation",
    "create_note",
    "update_note",
  ]);
  assert.deepEqual(ZOTERO_MCP_TOOLS.map((tool) => tool.name), EXPECTED_TOOLS);
  assert.deepEqual(Object.keys(ZOTERO_MCP_TOOL_BY_NAME), EXPECTED_TOOLS);
  assert.equal(new Set(EXPECTED_TOOLS).size, EXPECTED_TOOLS.length);

  assert.equal(Object.hasOwn(ZOTERO_MCP_TOOL_BY_NAME, "zotero_inspect_arxiv"), false);
  assert.equal(Object.hasOwn(ZOTERO_MCP_TOOL_BY_NAME, "zotero_ensure_arxiv_pdf"), false);

  const publishedContract = JSON.stringify(ZOTERO_MCP_TOOLS);
  assert.doesNotMatch(publishedContract, /(?:\/Users\/|\.dryforge(?:\/|\\)|bridgeRoot|sk-(?:proj-)?[A-Za-z0-9_-]{16,})/u);
});

test("native capability schema remains the shared v1 envelope without exposing retired tools", () => {
  const projected = ZOTERO_MCP_TOOL_BY_NAME.zotero_connection_status
    .outputSchema.$defs.connectionStatusResult;
  assert.deepEqual(projected, protocolResponseSchema.$defs.connectionStatusResult);
  assert.ok(
    projected.properties.capabilities.properties.operations.items.enum
      .includes("inspect_arxiv"),
  );
  assert.equal(Object.hasOwn(ZOTERO_MCP_TOOL_BY_NAME, "zotero_inspect_arxiv"), false);
});

test("MCP annotations identify reads, writes, replacement risk, replay, and local scope", () => {
  for (const tool of ZOTERO_MCP_TOOLS) {
    assert.deepEqual(Object.keys(tool.annotations).sort(), [
      "destructiveHint",
      "idempotentHint",
      "openWorldHint",
      "readOnlyHint",
    ]);
    assert.equal(tool.annotations.readOnlyHint, !WRITES.has(tool.name), tool.name);
    assert.equal(tool.annotations.destructiveHint, DESTRUCTIVE.has(tool.name), tool.name);
    assert.equal(tool.annotations.idempotentHint, true, tool.name);
    assert.equal(tool.annotations.openWorldHint, false, tool.name);
  }
});

test("all input fixtures satisfy strict self-contained schemas and fix v1 operation envelopes", () => {
  assert.equal(callsFixture.schemaVersion, 1);
  assert.equal(callsFixture.calls.length, EXPECTED_OPERATIONS.length);

  for (const fixture of callsFixture.calls) {
    const validateInput = validatorsFor(fixture.tool).input;
    assert.equal(validateInput(fixture.input), true, JSON.stringify(validateInput.errors));

    const prepared = prepareZoteroMcpToolCall(fixture.tool, fixture.input);
    assert.equal(prepared.kind, "operation");
    assert.equal(prepared.operation, fixture.operation);
    assert.equal(prepared.request.protocolVersion, 1);
    assert.equal(prepared.request.operation, fixture.operation);
    assert.equal(prepared.request.operationId, fixture.input.operationId);

    if (fixture.operation === "connection_status") {
      assert.deepEqual(Object.keys(fixture.input), ["operationId"]);
      assert.deepEqual(prepared.request.payload, {});
      assert.equal("profileId" in prepared.request, false);
    } else {
      assert.deepEqual(prepared.connection, fixture.input.connection);
      assert.equal(prepared.request.profileId, fixture.input.connection.profileId);
      assert.deepEqual(prepared.request.payload, fixture.input.payload);
    }

    if (WRITES.has(fixture.tool)) {
      assert.deepEqual(prepared.request.authorization, fixture.input.authorization);
    } else {
      assert.equal("authorization" in prepared.request, false);
    }
  }

  const lookupValidator = validatorsFor(callsFixture.lookup.tool).input;
  assert.equal(
    lookupValidator(callsFixture.lookup.input),
    true,
    JSON.stringify(lookupValidator.errors),
  );
  const lookup = prepareZoteroMcpToolCall(
    callsFixture.lookup.tool,
    callsFixture.lookup.input,
  );
  assert.deepEqual(lookup, {
    kind: "lookup",
    toolName: "zotero_get_operation_result",
    operationId: "mcp.read-note-1",
    connection: callsFixture.connection,
  });
  assert.equal("request" in lookup, false);
});

test("input schemas embed the existing v1 payload definitions instead of redefining them", () => {
  for (const [operation, definitionName] of Object.entries(PAYLOAD_DEFINITION)) {
    const tool = ZOTERO_MCP_TOOL_BY_NAME[`zotero_${operation}`];
    assert.ok(tool);
    assert.equal(tool.inputSchema.properties.payload.$ref, `#/$defs/${definitionName}`);
    assert.deepEqual(
      tool.inputSchema.$defs[definitionName],
      protocolRequestSchema.$defs[definitionName],
      operation,
    );
  }
});

test("input contracts reject unknown fields, weak identities, wrong authorization, and semantic payload errors", () => {
  const read = callFor("zotero_read_pdf").input;
  const readValidator = validatorsFor("zotero_read_pdf").input;
  const write = callFor("zotero_create_note").input;
  const writeValidator = validatorsFor("zotero_create_note").input;
  const lookupValidator = validatorsFor("zotero_get_operation_result").input;

  for (const invalid of [
    { ...read, operation: "read_pdf" },
    { ...read, protocolVersion: 1 },
    { ...read, authorization: { kind: "explicit_request", scope: "Read it." } },
    { ...read, connection: { ...read.connection, extra: true } },
    { ...read, connection: { ...read.connection, sessionId: "ABCDEF0123456789ABCDEF0123456789" } },
    { ...read, operationId: "../escape" },
  ]) {
    assert.equal(readValidator(invalid), false, JSON.stringify(invalid));
    assert.throws(() => prepareZoteroMcpToolCall("zotero_read_pdf", invalid));
  }

  const reversedRange = structuredClone(read);
  reversedRange.payload.pageRange = { startPageIndex: 10, endPageIndex: 2 };
  assert.equal(readValidator(reversedRange), true, JSON.stringify(readValidator.errors));
  assert.throws(() => prepareZoteroMcpToolCall("zotero_read_pdf", reversedRange));

  const missingAuthorization = structuredClone(write);
  delete missingAuthorization.authorization;
  assert.equal(writeValidator(missingAuthorization), false);
  assert.throws(() => prepareZoteroMcpToolCall("zotero_create_note", missingAuthorization));

  assert.equal(
    lookupValidator({ ...callsFixture.lookup.input, payload: {} }),
    false,
  );
  assert.throws(() => prepareZoteroMcpToolCall(
    "zotero_get_operation_result",
    { ...callsFixture.lookup.input, authorization: write.authorization },
  ));
  assert.throws(() => prepareZoteroMcpToolCall("zotero_inspect_arxiv", {
    operationId: "mcp.retired-1",
  }));
});

test("operation-specific output schemas and runtime joins accept every successful fixture", () => {
  assert.equal(resultsFixture.schemaVersion, 1);
  assert.equal(resultsFixture.successful.length, EXPECTED_OPERATIONS.length);

  for (const fixture of resultsFixture.successful) {
    const expected = resultsByTool.get(fixture.tool);
    const validateOutput = validatorsFor(fixture.tool).output;
    assert.equal(validateOutput(expected), true, JSON.stringify(validateOutput.errors));
    assert.equal(
      validateZoteroMcpResult(currentContext(fixture.tool), expected),
      expected,
      fixture.tool,
    );
  }

  const recordedTool = callsFixture.lookup.recordedTool;
  const lookupResult = resultsByTool.get(recordedTool);
  const validateLookupOutput = validatorsFor(callsFixture.lookup.tool).output;
  assert.equal(validateLookupOutput(lookupResult), true, JSON.stringify(validateLookupOutput.errors));
  assert.equal(
    validateZoteroMcpResult(
      lookupContext("observed_published"),
      lookupResult,
    ),
    lookupResult,
  );
});

test("native rejection and failure remain published native results, not wrapper errors", () => {
  const fixture = resultsFixture.nativeRejection;
  const validateOutput = validatorsFor(fixture.tool).output;
  assert.equal(validateOutput(fixture.result), true, JSON.stringify(validateOutput.errors));
  assert.equal(
    validateZoteroMcpResult(currentContext(fixture.tool), fixture.result),
    fixture.result,
  );
  assert.equal(fixture.result.result.state, "rejected");
  assert.equal(fixture.result.error, null);

  const failed = structuredClone(fixture.result);
  failed.result.state = "failed";
  failed.result.error = {
    code: "storage_error",
    message: "Native persistence failed before a confirmed write.",
    retryable: false,
  };
  assert.equal(validateOutput(failed), true, JSON.stringify(validateOutput.errors));
  assert.equal(
    validateZoteroMcpResult(currentContext(fixture.tool), failed),
    failed,
  );
  assert.equal(failed.error, null);
});

test("wrapper failures distinguish unpublished, published-timeout, and unavailable history", () => {
  const unpublished = resultsFixture.unpublishedFailure;
  assert.equal(validatorsFor(unpublished.tool).output(unpublished.result), true);
  assert.equal(
    validateZoteroMcpResult(
      currentContext(unpublished.tool, "observed_not_published"),
      unpublished.result,
    ),
    unpublished.result,
  );

  const timedOut = resultsFixture.publishedTimeout;
  assert.equal(validatorsFor(timedOut.tool).output(timedOut.result), true);
  assert.equal(
    validateZoteroMcpResult(currentContext(timedOut.tool), timedOut.result),
    timedOut.result,
  );

  const unavailable = resultsFixture.unavailableHistory;
  assert.equal(validatorsFor(unavailable.tool).output(unavailable.result), true);
  assert.equal(
    validateZoteroMcpResult({
      toolName: callsFixture.lookup.tool,
      input: callsFixture.lookup.input,
      publication: "unknown",
    }, unavailable.result),
    unavailable.result,
  );
  assert.equal(
    validateZoteroMcpResult({
      toolName: callsFixture.lookup.tool,
      input: callsFixture.lookup.input,
      publication: "unknown",
      recordedRequest: { invalid: "history" },
    }, unavailable.result),
    unavailable.result,
  );

  const currentUnknown = structuredClone(unavailable.result);
  assert.equal(
    validateZoteroMcpResult(
      currentContext("zotero_read_note", "unknown"),
      currentUnknown,
    ),
    currentUnknown,
  );

  assert.deepEqual(WRAPPER_ERROR_CODES, [
    "invalid_input",
    "connection_unavailable",
    "connection_changed",
    "access_denied",
    "identity_conflict",
    "wait_expired",
    "invalid_result",
    "result_too_large",
    "io_error",
  ]);
});

test("result contracts reject unknown fields, empty outcomes, and conflicting native/wrapper outcomes", () => {
  const successful = resultsByTool.get("zotero_read_note");
  const validateOutput = validatorsFor("zotero_read_note").output;
  const unknown = { ...successful, surprise: true };
  const empty = { ...successful, result: null, error: null };
  const conflicting = {
    ...successful,
    error: { code: "io_error", message: "Conflicting wrapper error." },
  };

  for (const invalid of [unknown, empty, conflicting]) {
    assert.equal(validateOutput(invalid), false, JSON.stringify(validateOutput.errors));
    assert.throws(() => validateZoteroMcpResult(
      currentContext("zotero_read_note"),
      invalid,
    ));
  }
});

test("projected output schemas retain shared response lifecycle constraints", () => {
  const successful = resultsByTool.get("zotero_read_note");
  const validateOutput = validatorsFor("zotero_read_note").output;
  const runningWithData = structuredClone(successful);
  runningWithData.result.state = "running";
  const succeededWithoutData = structuredClone(successful);
  succeededWithoutData.result.data = null;

  for (const invalid of [runningWithData, succeededWithoutData]) {
    assert.equal(validateOutput(invalid), false, JSON.stringify(validateOutput.errors));
    assert.throws(() => validateZoteroMcpResult(
      currentContext("zotero_read_note"),
      invalid,
    ));
  }
});

test("delivery evidence cannot be rewritten across current calls and historical lookup", () => {
  const unpublished = resultsFixture.unpublishedFailure;
  const falselyPublished = { ...unpublished.result, delivery: "published" };
  assert.throws(() => validateZoteroMcpResult(
    currentContext(unpublished.tool, "observed_not_published"),
    falselyPublished,
  ));

  const native = resultsByTool.get("zotero_read_note");
  assert.throws(() => validateZoteroMcpResult(
    lookupContext("unknown"),
    { ...native, delivery: "unconfirmed" },
  ));
  assert.throws(() => validateZoteroMcpResult(
    lookupContext("observed_not_published"),
    resultsFixture.unavailableHistory.result,
  ));
});

test("recorded request, response identity, operation data, profile, and session must join", () => {
  for (const fixture of resultsFixture.badJoins) {
    assert.throws(
      () => validateZoteroMcpResult(currentContext(fixture.tool), fixture.result),
      undefined,
      fixture.id,
    );
  }

  const native = resultsByTool.get("zotero_read_note");
  const wrongSession = structuredClone(native);
  wrongSession.connection.sessionId = "abcdef0123456789abcdef0123456789";
  assert.throws(() => validateZoteroMcpResult(
    currentContext("zotero_read_note"),
    wrongSession,
  ));

  const wrongRecorded = prepareZoteroMcpToolCall(
    "zotero_search_papers",
    callFor("zotero_search_papers").input,
  );
  assert.equal(wrongRecorded.kind, "operation");
  assert.throws(() => validateZoteroMcpResult(
    {
      ...lookupContext("observed_published"),
      recordedRequest: wrongRecorded.request,
    },
    native,
  ));
});

test("lookup validates against the recorded active operation and never creates a publish request", () => {
  const lookup = prepareZoteroMcpToolCall(
    callsFixture.lookup.tool,
    callsFixture.lookup.input,
  );
  assert.equal(lookup.kind, "lookup");
  assert.equal("request" in lookup, false);

  const wrongShape = structuredClone(resultsByTool.get("zotero_read_note"));
  wrongShape.result.data = { annotations: [] };
  assert.throws(() => validateZoteroMcpResult(
    lookupContext("observed_published"),
    wrongShape,
  ));

  assert.throws(() => validateZoteroMcpResult(
    {
      toolName: callsFixture.lookup.tool,
      input: callsFixture.lookup.input,
      publication: "observed_published",
    },
    resultsByTool.get("zotero_read_note"),
  ));
  assert.throws(() => validateZoteroMcpResult(
    {
      toolName: callsFixture.lookup.tool,
      input: callsFixture.lookup.input,
      publication: "observed_published",
      recordedRequest: { invalid: "history" },
    },
    resultsByTool.get("zotero_read_note"),
  ));

  assert.throws(() => validateZoteroMcpResult(
    {
      ...lookupContext("observed_published"),
      recordedRequest: {
        protocolVersion: 1,
        operationId: "mcp.read-note-1",
        operation: "inspect_arxiv",
        profileId: "profile-A",
        payload: { url: "https://arxiv.org/abs/2401.01234" },
      },
    },
    resultsByTool.get("zotero_read_note"),
  ));
});

test("validation returns complete native bodies without truncation or rewriting", () => {
  const value = structuredClone(resultsByTool.get("zotero_read_note"));
  const body = "긴 연구 메모의 모든 문장과 수식 보존.\n".repeat(12_000);
  value.result.data.content = body;
  const accepted = validateZoteroMcpResult(
    currentContext("zotero_read_note"),
    value,
  );
  assert.equal(accepted, value);
  assert.equal(accepted.result.data.content, body);
  assert.ok(Buffer.byteLength(body, "utf8") > 500_000);
});

test("connection status accepts a valid native capability subset", () => {
  const value = structuredClone(resultsByTool.get("zotero_connection_status"));
  value.result.data.capabilities.operations = ["connection_status", "read_pdf"];
  const validateOutput = validatorsFor("zotero_connection_status").output;
  assert.equal(validateOutput(value), true, JSON.stringify(validateOutput.errors));
  assert.equal(
    validateZoteroMcpResult(currentContext("zotero_connection_status"), value),
    value,
  );
});
