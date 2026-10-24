import { readFileSync } from "node:fs";

import {
  PROTOCOL_VERSION,
  validateProtocolRequest,
  validateProtocolResponse,
} from "../../dist/protocol/index.js";

export const ACTIVE_PROTOCOL_OPERATIONS = Object.freeze([
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
]);

export const NATIVE_WRITE_OPERATIONS = Object.freeze([
  "create_annotation",
  "update_annotation",
  "create_note",
  "update_note",
]);

export const WRAPPER_ERROR_CODES = Object.freeze([
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

const ACTIVE_OPERATION_SET = new Set(ACTIVE_PROTOCOL_OPERATIONS);
const NATIVE_WRITE_SET = new Set(NATIVE_WRITE_OPERATIONS);
const WRAPPER_ERROR_CODE_SET = new Set(WRAPPER_ERROR_CODES);
const LOOKUP_TOOL_NAME = "zotero_get_operation_result";
const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/u;

const REQUEST_SCHEMA_URL = new URL(
  "../../scripts/package/assets/protocol/v1-request.schema.json",
  import.meta.url,
);
const RESPONSE_SCHEMA_URL = new URL(
  "../../scripts/package/assets/protocol/v1-response.schema.json",
  import.meta.url,
);

function loadJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

const protocolRequestSchema = loadJson(REQUEST_SCHEMA_URL);
const protocolResponseSchema = loadJson(RESPONSE_SCHEMA_URL);

const PAYLOAD_DEFINITION_BY_OPERATION = Object.freeze({
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
});

const RESULT_DEFINITION_BY_OPERATION = Object.freeze({
  connection_status: "connectionStatusResult",
  find_local_arxiv: "findLocalArxivResult",
  search_papers: "searchPapersResult",
  read_pdf: "readPdfResult",
  list_annotations: "listAnnotationsResult",
  list_notes: "listNotesResult",
  read_note: "readNoteResult",
  resolve_anchor: "resolveAnchorResult",
  create_annotation: "createAnnotationResult",
  update_annotation: "updateAnnotationResult",
  create_note: "noteMutationResult",
  update_note: "noteMutationResult",
  verify_annotation: "verifyAnnotationResult",
});

const TOOL_DESCRIPTION_BY_OPERATION = Object.freeze({
  connection_status: "Read the current Zotero companion connection and capability status.",
  find_local_arxiv: "Find locally saved Zotero PDFs matching an official arXiv URL.",
  search_papers: "Search papers already present in the connected Zotero profile.",
  read_pdf: "Read extracted text and passage evidence from a specific local Zotero PDF.",
  list_annotations: "List native annotations on a specific Zotero PDF attachment.",
  list_notes: "List child notes for a specific Zotero library item.",
  read_note: "Read one complete native Zotero child note.",
  resolve_anchor: "Resolve passage or inspected-region evidence to a PDF anchor.",
  create_annotation: "Create one explicitly authorized native Zotero annotation.",
  update_annotation: "Update one explicitly authorized native annotation after a revision check.",
  create_note: "Create one explicitly authorized native Zotero child note.",
  update_note: "Update one explicitly authorized native child note after a revision check.",
  verify_annotation: "Read native storage and active-reader evidence for one annotation.",
});

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function referencedDefinitionNames(value, names = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) referencedDefinitionNames(item, names);
    return names;
  }
  if (value === null || typeof value !== "object") return names;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) {
    const name = value.$ref.slice("#/$defs/".length).split("/", 1)[0];
    if (name.length > 0) names.add(name);
  }
  for (const child of Object.values(value)) referencedDefinitionNames(child, names);
  return names;
}

function selectDefinitions(source, roots) {
  const selected = {};
  const pending = [...roots];
  const seen = new Set();
  while (pending.length > 0) {
    const name = pending.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const definition = source[name];
    if (definition === undefined) {
      throw new Error(`Shared protocol schema lacks $defs/${name}`);
    }
    selected[name] = clone(definition);
    for (const dependency of referencedDefinitionNames(definition)) {
      if (!seen.has(dependency)) pending.push(dependency);
    }
  }
  return selected;
}

function connectionDefinition() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["profileId", "sessionId"],
    properties: {
      profileId: { $ref: "#/$defs/identifier" },
      sessionId: {
        type: "string",
        minLength: 32,
        maxLength: 32,
        pattern: "^[0-9a-f]{32}$",
      },
    },
  };
}

function makeInputSchema(operation) {
  const roots = ["operationId"];
  const required = ["operationId"];
  const properties = {
    operationId: { $ref: "#/$defs/operationId" },
  };

  if (operation !== "connection_status") {
    const payloadDefinition = PAYLOAD_DEFINITION_BY_OPERATION[operation];
    if (payloadDefinition === undefined) {
      throw new Error(`No active payload definition for ${operation}`);
    }
    roots.push("identifier", payloadDefinition);
    required.push("connection", "payload");
    properties.connection = { $ref: "#/$defs/connection" };
    properties.payload = { $ref: `#/$defs/${payloadDefinition}` };
    if (NATIVE_WRITE_SET.has(operation)) {
      roots.push("authorization");
      required.push("authorization");
      properties.authorization = { $ref: "#/$defs/authorization" };
    }
  }

  const definitions = selectDefinitions(protocolRequestSchema.$defs, roots);
  if (operation !== "connection_status") definitions.connection = connectionDefinition();
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://zoterowithgpt.local/schemas/mcp-v1/zotero_${operation}-input.json`,
    type: "object",
    additionalProperties: false,
    required,
    properties,
    $defs: definitions,
  };
}

function makeLookupInputSchema() {
  const definitions = selectDefinitions(protocolRequestSchema.$defs, [
    "operationId",
    "identifier",
  ]);
  definitions.connection = connectionDefinition();
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://zoterowithgpt.local/schemas/mcp-v1/zotero_get_operation_result-input.json",
    type: "object",
    additionalProperties: false,
    required: ["operationId", "connection"],
    properties: {
      operationId: { $ref: "#/$defs/operationId" },
      connection: { $ref: "#/$defs/connection" },
    },
    $defs: definitions,
  };
}

function makeProtocolResponseDefinition(operation) {
  const resultDefinitionNames = operation === null
    ? [...new Set(ACTIVE_PROTOCOL_OPERATIONS.map(
      (name) => RESULT_DEFINITION_BY_OPERATION[name],
    ))]
    : [RESULT_DEFINITION_BY_OPERATION[operation]];
  if (resultDefinitionNames.some((name) => name === undefined)) {
    throw new Error(`No active result definition for ${String(operation)}`);
  }

  const response = {
    type: "object",
    additionalProperties: false,
    required: clone(protocolResponseSchema.required),
    properties: {
      protocolVersion: clone(protocolResponseSchema.properties.protocolVersion),
      operationId: clone(protocolResponseSchema.properties.operationId),
      state: clone(protocolResponseSchema.properties.state),
      data: {
        oneOf: [
          { type: "null" },
          ...resultDefinitionNames.map((name) => ({ $ref: `#/$defs/${name}` })),
        ],
      },
      error: clone(protocolResponseSchema.properties.error),
      verification: clone(protocolResponseSchema.properties.verification),
    },
  };
  const roots = ["identifier", ...referencedDefinitionNames(response)];
  const definitions = selectDefinitions(protocolResponseSchema.$defs, roots);
  // The shared protocol schema retains historical result readability. The MCP
  // surface narrows advertised connection capabilities to executable v1 names.
  const connectionStatus = definitions.connectionStatusResult;
  if (connectionStatus !== undefined) {
    connectionStatus.properties.capabilities.properties.operations.items.enum = [
      ...ACTIVE_PROTOCOL_OPERATIONS,
    ];
  }
  return { response, definitions };
}

function makeOutputSchema(toolName, operation) {
  const { response, definitions } = makeProtocolResponseDefinition(operation);
  definitions.connection = connectionDefinition();
  definitions.wrapperError = {
    type: "object",
    additionalProperties: false,
    required: ["code", "message"],
    properties: {
      code: { enum: [...WRAPPER_ERROR_CODES] },
      message: { type: "string" },
    },
  };
  definitions.protocolResponse = response;

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://zoterowithgpt.local/schemas/mcp-v1/${toolName}-result.json`,
    type: "object",
    additionalProperties: false,
    required: ["connection", "delivery", "result", "error"],
    properties: {
      connection: {
        oneOf: [
          { type: "null" },
          { $ref: "#/$defs/connection" },
        ],
      },
      delivery: {
        enum: ["not_published", "published", "unconfirmed"],
      },
      result: {
        oneOf: [
          { type: "null" },
          { $ref: "#/$defs/protocolResponse" },
        ],
      },
      error: {
        oneOf: [
          { type: "null" },
          { $ref: "#/$defs/wrapperError" },
        ],
      },
    },
    oneOf: [
      {
        properties: {
          connection: { $ref: "#/$defs/connection" },
          delivery: { const: "published" },
          result: { $ref: "#/$defs/protocolResponse" },
          error: { type: "null" },
        },
      },
      {
        properties: {
          result: { type: "null" },
          error: { $ref: "#/$defs/wrapperError" },
        },
      },
    ],
    $defs: definitions,
  };
}

function annotationsFor(operation) {
  const write = operation !== null && NATIVE_WRITE_SET.has(operation);
  return {
    readOnlyHint: !write,
    destructiveHint: operation === "update_annotation" || operation === "update_note",
    idempotentHint: true,
    openWorldHint: false,
  };
}

const operationTools = ACTIVE_PROTOCOL_OPERATIONS.map((operation) => {
  const name = `zotero_${operation}`;
  return deepFreeze({
    name,
    description: TOOL_DESCRIPTION_BY_OPERATION[operation],
    inputSchema: makeInputSchema(operation),
    outputSchema: makeOutputSchema(name, operation),
    annotations: annotationsFor(operation),
  });
});

const lookupTool = deepFreeze({
  name: LOOKUP_TOOL_NAME,
  description: "Read a recorded Zotero protocol result without publishing another request.",
  inputSchema: makeLookupInputSchema(),
  outputSchema: makeOutputSchema(LOOKUP_TOOL_NAME, null),
  annotations: annotationsFor(null),
});

export const ZOTERO_MCP_TOOLS = Object.freeze([...operationTools, lookupTool]);

export const ZOTERO_MCP_TOOL_BY_NAME = Object.freeze(Object.fromEntries(
  ZOTERO_MCP_TOOLS.map((tool) => [tool.name, tool]),
));

export class ZoteroMcpContractError extends Error {
  constructor(message, options = undefined) {
    super(message, options);
    this.name = "ZoteroMcpContractError";
  }
}

function fail(message, cause = undefined) {
  const options = cause === undefined ? undefined : { cause };
  throw new ZoteroMcpContractError(message, options);
}

function expectRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(`${path} must be a plain JSON object`);
  }
  return value;
}

function expectExactKeys(record, allowed, required, path) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedSet.has(key));
  if (unknown !== undefined) fail(`${path}.${unknown} is not supported`);
  const missing = required.find(
    (key) => !Object.prototype.hasOwnProperty.call(record, key),
  );
  if (missing !== undefined) fail(`${path}.${missing} is required`);
}

function validateConnection(value, operationId, path) {
  const connection = expectRecord(value, path);
  expectExactKeys(
    connection,
    ["profileId", "sessionId"],
    ["profileId", "sessionId"],
    path,
  );
  if (typeof connection.sessionId !== "string" || !SESSION_ID_PATTERN.test(connection.sessionId)) {
    fail(`${path}.sessionId must be 32 lowercase hexadecimal characters`);
  }
  try {
    validateProtocolRequest({
      protocolVersion: PROTOCOL_VERSION,
      operationId,
      operation: "connection_status",
      profileId: connection.profileId,
      payload: {},
    });
  } catch (cause) {
    fail(`${path} does not contain valid protocol identities`, cause);
  }
  return connection;
}

function validateConstructedRequest(request) {
  try {
    return validateProtocolRequest(request);
  } catch (cause) {
    fail("MCP input does not form a valid protocol-v1 request", cause);
  }
}

/**
 * Strictly validates tool arguments and constructs the fixed protocol request.
 * Lookup returns no request because it must never publish another operation.
 */
export function prepareZoteroMcpToolCall(toolName, value) {
  if (toolName === LOOKUP_TOOL_NAME) {
    const input = expectRecord(value, "$input");
    expectExactKeys(
      input,
      ["operationId", "connection"],
      ["operationId", "connection"],
      "$input",
    );
    const connection = validateConnection(input.connection, input.operationId, "$input.connection");
    return {
      kind: "lookup",
      toolName,
      operationId: input.operationId,
      connection,
    };
  }

  if (
    typeof toolName !== "string" ||
    !Object.prototype.hasOwnProperty.call(ZOTERO_MCP_TOOL_BY_NAME, toolName)
  ) {
    fail("Tool name is not part of the Zotero MCP contract");
  }
  const operation = toolName.slice("zotero_".length);
  const input = expectRecord(value, "$input");
  if (operation === "connection_status") {
    expectExactKeys(input, ["operationId"], ["operationId"], "$input");
    const request = validateConstructedRequest({
      protocolVersion: PROTOCOL_VERSION,
      operationId: input.operationId,
      operation,
      payload: {},
    });
    return {
      kind: "operation",
      toolName,
      operation,
      connection: null,
      request,
    };
  }

  const write = NATIVE_WRITE_SET.has(operation);
  const allowed = write
    ? ["operationId", "connection", "authorization", "payload"]
    : ["operationId", "connection", "payload"];
  expectExactKeys(input, allowed, allowed, "$input");
  const connection = validateConnection(input.connection, input.operationId, "$input.connection");
  const request = {
    protocolVersion: PROTOCOL_VERSION,
    operationId: input.operationId,
    operation,
    profileId: connection.profileId,
    ...(write ? { authorization: input.authorization } : {}),
    payload: input.payload,
  };
  return {
    kind: "operation",
    toolName,
    operation,
    connection,
    request: validateConstructedRequest(request),
  };
}

function equalConnection(left, right) {
  return left.profileId === right.profileId && left.sessionId === right.sessionId;
}

function validateWrapperError(value) {
  const error = expectRecord(value, "$result.error");
  expectExactKeys(error, ["code", "message"], ["code", "message"], "$result.error");
  if (!WRAPPER_ERROR_CODE_SET.has(error.code)) {
    fail("$result.error.code is not supported");
  }
  if (typeof error.message !== "string") fail("$result.error.message must be a string");
  return error;
}

function validateActiveCapabilities(response) {
  if (response.state !== "succeeded") return;
  const operations = response.data.capabilities.operations;
  if (
    operations.length !== ACTIVE_PROTOCOL_OPERATIONS.length ||
    operations.some((operation) => !ACTIVE_OPERATION_SET.has(operation))
  ) {
    fail("connection_status must advertise exactly the active MCP protocol operations");
  }
}

function requestForResultContext(context, prepared) {
  if (prepared.kind === "operation") {
    if (Object.prototype.hasOwnProperty.call(context, "recordedRequest")) {
      fail("Current invocations do not accept a recordedRequest");
    }
    if (context.publication === "unknown") {
      fail("Current invocations cannot claim unknown publication history");
    }
    return prepared.request;
  }

  if (context.publication === "observed_not_published") {
    fail("Historical lookup cannot claim not_published for a prior invocation");
  }
  if (!Object.prototype.hasOwnProperty.call(context, "recordedRequest")) {
    return fail("Historical lookup requires its recorded protocol request");
  }
  let request;
  try {
    request = validateProtocolRequest(context.recordedRequest);
  } catch (cause) {
    return fail("Historical lookup recordedRequest is invalid", cause);
  }
  if (!ACTIVE_OPERATION_SET.has(request.operation)) {
    fail("Historical lookup only exposes active Zotero MCP operations");
  }
  if (request.operationId !== prepared.operationId) {
    fail("Historical lookup operationId does not match its recorded request");
  }
  if (
    request.operation !== "connection_status" &&
    request.profileId !== prepared.connection.profileId
  ) {
    fail("Historical lookup profile does not match its recorded request");
  }
  if (
    request.operation === "connection_status" &&
    request.profileId !== undefined &&
    request.profileId !== prepared.connection.profileId
  ) {
    fail("Historical connection-status profile does not match its recorded request");
  }
  return request;
}

function validateResultConnection(value, prepared, nativeResult) {
  if (value === null) {
    if (nativeResult) fail("A native result requires the observed connection identity");
    return null;
  }
  const operationId = prepared.kind === "lookup"
    ? prepared.operationId
    : prepared.request.operationId;
  const connection = validateConnection(value, operationId, "$result.connection");
  const expected = prepared.connection;
  if (expected !== null && !equalConnection(connection, expected)) {
    fail("Result connection does not match the invoked connection");
  }
  return connection;
}

/**
 * Validates one exact MCP structured result against the invocation or the
 * recorded request used by lookup. `publication` is transport evidence:
 * observed_published, observed_not_published, or unknown.
 */
export function validateZoteroMcpResult(contextValue, value) {
  const context = expectRecord(contextValue, "$context");
  expectExactKeys(
    context,
    ["toolName", "input", "publication", "recordedRequest"],
    ["toolName", "input", "publication"],
    "$context",
  );
  if (
    context.publication !== "observed_published" &&
    context.publication !== "observed_not_published" &&
    context.publication !== "unknown"
  ) {
    fail("$context.publication is not supported");
  }
  const prepared = prepareZoteroMcpToolCall(context.toolName, context.input);
  const request = requestForResultContext(context, prepared);

  const result = expectRecord(value, "$result");
  expectExactKeys(
    result,
    ["connection", "delivery", "result", "error"],
    ["connection", "delivery", "result", "error"],
    "$result",
  );
  if (
    result.delivery !== "not_published" &&
    result.delivery !== "published" &&
    result.delivery !== "unconfirmed"
  ) {
    fail("$result.delivery is not supported");
  }

  const nativeResult = result.result !== null;
  const connection = validateResultConnection(result.connection, prepared, nativeResult);
  if (nativeResult) {
    if (result.error !== null) fail("A native result requires null wrapper error");
    if (result.delivery !== "published") fail("A native result must be published");
    if (context.publication !== "observed_published") {
      fail("A native result requires observed publication evidence");
    }
    let response;
    try {
      response = validateProtocolResponse(request.operation, result.result);
    } catch (cause) {
      return fail("Native result does not match its recorded protocol operation", cause);
    }
    if (response.operationId !== request.operationId) {
      fail("Native result operationId does not match its recorded request");
    }
    if (request.operation === "connection_status") {
      validateActiveCapabilities(response);
      if (
        response.state === "succeeded" &&
        response.data.profile.id !== connection.profileId
      ) {
        fail("Connection-status profile does not match the observed connection");
      }
    }
    return value;
  }

  if (result.error === null) fail("A null native result requires a wrapper error");
  validateWrapperError(result.error);
  const deliveryByEvidence = {
    observed_published: "published",
    observed_not_published: "not_published",
    unknown: "unconfirmed",
  };
  if (result.delivery !== deliveryByEvidence[context.publication]) {
    fail("Result delivery does not match the available publication evidence");
  }
  if (result.delivery === "published" && connection === null) {
    fail("Published delivery requires the observed connection identity");
  }
  return value;
}
