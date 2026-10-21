import {
  MAX_AUTHORIZATION_SCOPE_BYTES,
  MAX_EXCERPT_BYTES,
  MAX_IDENTIFIER_BYTES,
  MAX_PAGE_SPAN,
  MAX_QUERY_BYTES,
  MAX_RECTANGLES,
  MAX_REQUEST_BYTES,
  MAX_RESULT_LIMIT,
  MAX_TEXT_BYTES,
  NATIVE_ANNOTATION_COLORS,
  OPERATION_NAMES,
  isMutationOperation,
} from "./constants.js";
import {
  PROTOCOL_VERSION,
  type OperationName,
  type ProtocolErrorCode,
  type ProtocolRequest,
} from "./types.js";

const encoder = new TextEncoder();

export class ProtocolValidationError extends Error {
  readonly code: ProtocolErrorCode;
  readonly retryable: boolean;

  constructor(code: ProtocolErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ProtocolValidationError";
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: ProtocolErrorCode, message: string): never {
  throw new ProtocolValidationError(code, message);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("invalid_request", `${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail("invalid_request", `${path} must be a plain JSON object`);
  }
  return value as Record<string, unknown>;
}

function expectOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown !== undefined) fail("invalid_request", `${path}.${unknown} is not supported`);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

function expectString(
  value: unknown,
  path: string,
  options: { nonempty?: boolean; maxBytes?: number } = {},
): string {
  if (typeof value !== "string") fail("invalid_request", `${path} must be a string`);
  if (options.nonempty === true && value.trim().length === 0) {
    fail("invalid_request", `${path} must not be empty`);
  }
  if (options.maxBytes !== undefined && utf8Length(value) > options.maxBytes) {
    fail("too_large", `${path} exceeds ${options.maxBytes} UTF-8 bytes`);
  }
  return value;
}

function expectIdentifier(value: unknown, path: string): string {
  return expectString(value, path, { nonempty: true, maxBytes: MAX_IDENTIFIER_BYTES });
}

function expectNonnegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("invalid_request", `${path} must be a nonnegative safe integer`);
  }
  return value as number;
}

function expectLimit(value: unknown, path: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_RESULT_LIMIT) {
    fail("invalid_request", `${path} must be an integer from 1 to ${MAX_RESULT_LIMIT}`);
  }
}

function expectFiniteCoordinate(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("invalid_request", `${path} must be a finite nonnegative number`);
  }
  return value;
}

function validateRectangle(value: unknown, path: string): void {
  const rectangle = expectRecord(value, path);
  expectOnlyKeys(rectangle, ["x1", "y1", "x2", "y2"], path);
  const x1 = expectFiniteCoordinate(rectangle.x1, `${path}.x1`);
  const y1 = expectFiniteCoordinate(rectangle.y1, `${path}.y1`);
  const x2 = expectFiniteCoordinate(rectangle.x2, `${path}.x2`);
  const y2 = expectFiniteCoordinate(rectangle.y2, `${path}.y2`);
  if (x2 <= x1 || y2 <= y1) {
    fail("invalid_request", `${path} must have x2 > x1 and y2 > y1`);
  }
}

function validateRectangles(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECTANGLES) {
    fail("invalid_request", `${path} must contain 1 to ${MAX_RECTANGLES} rectangles`);
  }
  value.forEach((rectangle, index) => validateRectangle(rectangle, `${path}[${index}]`));
}

function validateMatchEvidence(value: unknown, path: string): void {
  const evidence = expectRecord(value, path);
  expectOnlyKeys(evidence, ["method", "matchedText", "exact"], path);
  if (
    evidence.method !== "exact_quote" &&
    evidence.method !== "quote_with_context" &&
    evidence.method !== "inspected_region"
  ) {
    fail("invalid_request", `${path}.method is not supported`);
  }
  if (typeof evidence.exact !== "boolean") {
    fail("invalid_request", `${path}.exact must be a boolean`);
  }
  if (hasOwn(evidence, "matchedText")) {
    expectString(evidence.matchedText, `${path}.matchedText`, {
      nonempty: true,
      maxBytes: MAX_EXCERPT_BYTES,
    });
  } else if (evidence.method !== "inspected_region") {
    fail("invalid_request", `${path}.matchedText is required for quote evidence`);
  }
  if (evidence.method === "exact_quote" && evidence.exact !== true) {
    fail("invalid_request", `${path}.exact must be true for exact_quote evidence`);
  }
}

function validateResolvedAnchor(value: unknown, path: string): Record<string, unknown> {
  const anchor = expectRecord(value, path);
  expectOnlyKeys(
    anchor,
    [
      "libraryId",
      "itemKey",
      "attachmentKey",
      "attachmentFingerprint",
      "pageIndex",
      "pageLabel",
      "rectangles",
      "selectedText",
      "matchEvidence",
    ],
    path,
  );
  expectIdentifier(anchor.libraryId, `${path}.libraryId`);
  expectIdentifier(anchor.itemKey, `${path}.itemKey`);
  expectIdentifier(anchor.attachmentKey, `${path}.attachmentKey`);
  expectIdentifier(anchor.attachmentFingerprint, `${path}.attachmentFingerprint`);
  expectNonnegativeInteger(anchor.pageIndex, `${path}.pageIndex`);
  expectString(anchor.pageLabel, `${path}.pageLabel`, { nonempty: true, maxBytes: 256 });
  validateRectangles(anchor.rectangles, `${path}.rectangles`);
  if (hasOwn(anchor, "selectedText")) {
    expectString(anchor.selectedText, `${path}.selectedText`, {
      nonempty: true,
      maxBytes: MAX_EXCERPT_BYTES,
    });
  }
  validateMatchEvidence(anchor.matchEvidence, `${path}.matchEvidence`);
  return anchor;
}

function validateLibraryItemPayload(
  payload: Record<string, unknown>,
  path: string,
  allowedKeys: readonly string[],
): void {
  expectOnlyKeys(payload, allowedKeys, path);
  expectIdentifier(payload.libraryId, `${path}.libraryId`);
  expectIdentifier(payload.itemKey, `${path}.itemKey`);
}

function validateLibraryAttachmentPayload(
  payload: Record<string, unknown>,
  path: string,
  allowedKeys: readonly string[],
): void {
  expectOnlyKeys(payload, allowedKeys, path);
  expectIdentifier(payload.libraryId, `${path}.libraryId`);
  expectIdentifier(payload.attachmentKey, `${path}.attachmentKey`);
}

function validatePageRange(value: unknown, path: string): void {
  const range = expectRecord(value, path);
  expectOnlyKeys(range, ["startPageIndex", "endPageIndex"], path);
  const start = expectNonnegativeInteger(range.startPageIndex, `${path}.startPageIndex`);
  const end = expectNonnegativeInteger(range.endPageIndex, `${path}.endPageIndex`);
  if (end < start) fail("invalid_request", `${path}.endPageIndex must be at least startPageIndex`);
  if (end - start + 1 > MAX_PAGE_SPAN) {
    fail("too_large", `${path} may contain at most ${MAX_PAGE_SPAN} pages`);
  }
}

function validateQuote(value: unknown, path: string): void {
  const quote = expectRecord(value, path);
  expectOnlyKeys(quote, ["exact", "prefix", "suffix"], path);
  expectString(quote.exact, `${path}.exact`, { nonempty: true, maxBytes: MAX_EXCERPT_BYTES });
  if (hasOwn(quote, "prefix")) {
    expectString(quote.prefix, `${path}.prefix`, { maxBytes: MAX_EXCERPT_BYTES });
  }
  if (hasOwn(quote, "suffix")) {
    expectString(quote.suffix, `${path}.suffix`, { maxBytes: MAX_EXCERPT_BYTES });
  }
}

function validateInspectedRegion(value: unknown, path: string): void {
  const region = expectRecord(value, path);
  expectOnlyKeys(region, ["rectangles", "selectedText"], path);
  validateRectangles(region.rectangles, `${path}.rectangles`);
  if (hasOwn(region, "selectedText")) {
    expectString(region.selectedText, `${path}.selectedText`, {
      nonempty: true,
      maxBytes: MAX_EXCERPT_BYTES,
    });
  }
}

function validatePayload(operation: OperationName, value: unknown): void {
  const payload = expectRecord(value, "$.payload");
  switch (operation) {
    case "connection_status":
      expectOnlyKeys(payload, [], "$.payload");
      return;
    case "search_papers":
      expectOnlyKeys(payload, ["query", "limit"], "$.payload");
      expectString(payload.query, "$.payload.query", {
        nonempty: true,
        maxBytes: MAX_QUERY_BYTES,
      });
      if (hasOwn(payload, "limit")) expectLimit(payload.limit, "$.payload.limit");
      return;
    case "read_pdf":
      validateLibraryItemPayload(
        payload,
        "$.payload",
        ["libraryId", "itemKey", "attachmentKey", "pageRange"],
      );
      expectIdentifier(payload.attachmentKey, "$.payload.attachmentKey");
      validatePageRange(payload.pageRange, "$.payload.pageRange");
      return;
    case "list_annotations":
      validateLibraryAttachmentPayload(payload, "$.payload", ["libraryId", "attachmentKey"]);
      return;
    case "list_notes":
      validateLibraryItemPayload(payload, "$.payload", ["libraryId", "itemKey", "limit"]);
      if (hasOwn(payload, "limit")) expectLimit(payload.limit, "$.payload.limit");
      return;
    case "read_note":
      validateLibraryItemPayload(payload, "$.payload", ["libraryId", "itemKey", "noteKey"]);
      expectIdentifier(payload.noteKey, "$.payload.noteKey");
      return;
    case "resolve_anchor": {
      expectOnlyKeys(
        payload,
        ["libraryId", "attachmentKey", "fingerprint", "pageIndex", "quote", "inspectedRegion"],
        "$.payload",
      );
      expectIdentifier(payload.libraryId, "$.payload.libraryId");
      expectIdentifier(payload.attachmentKey, "$.payload.attachmentKey");
      expectIdentifier(payload.fingerprint, "$.payload.fingerprint");
      expectNonnegativeInteger(payload.pageIndex, "$.payload.pageIndex");
      const hasQuote = hasOwn(payload, "quote");
      const hasRegion = hasOwn(payload, "inspectedRegion");
      if (hasQuote === hasRegion) {
        fail("invalid_request", "$.payload requires exactly one of quote or inspectedRegion");
      }
      if (hasQuote) validateQuote(payload.quote, "$.payload.quote");
      else validateInspectedRegion(payload.inspectedRegion, "$.payload.inspectedRegion");
      return;
    }
    case "create_annotation": {
      expectOnlyKeys(payload, ["anchor", "type", "comment", "color"], "$.payload");
      const anchor = validateResolvedAnchor(payload.anchor, "$.payload.anchor");
      if (payload.type !== "highlight" && payload.type !== "note") {
        fail("invalid_request", "$.payload.type must be highlight or note");
      }
      if (payload.type === "highlight" && !hasOwn(anchor, "selectedText")) {
        fail("invalid_request", "highlight anchors require selectedText");
      }
      expectString(payload.comment, "$.payload.comment", {
        nonempty: true,
        maxBytes: MAX_TEXT_BYTES,
      });
      if (hasOwn(payload, "color")) {
        const color = expectString(payload.color, "$.payload.color");
        if (!(NATIVE_ANNOTATION_COLORS as readonly string[]).includes(color)) {
          fail("unsupported_capability", "$.payload.color is not a native supported color");
        }
      }
      return;
    }
    case "update_annotation":
      validateLibraryAttachmentPayload(
        payload,
        "$.payload",
        ["libraryId", "attachmentKey", "annotationKey", "expectedRevision", "mode", "comment"],
      );
      expectIdentifier(payload.annotationKey, "$.payload.annotationKey");
      expectIdentifier(payload.expectedRevision, "$.payload.expectedRevision");
      if (payload.mode !== "append" && payload.mode !== "replace") {
        fail("invalid_request", "$.payload.mode must be append or replace");
      }
      expectString(payload.comment, "$.payload.comment", {
        nonempty: true,
        maxBytes: MAX_TEXT_BYTES,
      });
      return;
    case "create_note":
      validateLibraryItemPayload(payload, "$.payload", ["libraryId", "itemKey", "content"]);
      expectString(payload.content, "$.payload.content", {
        nonempty: true,
        maxBytes: MAX_TEXT_BYTES,
      });
      return;
    case "update_note":
      validateLibraryItemPayload(
        payload,
        "$.payload",
        ["libraryId", "itemKey", "noteKey", "expectedRevision", "mode", "content"],
      );
      expectIdentifier(payload.noteKey, "$.payload.noteKey");
      expectIdentifier(payload.expectedRevision, "$.payload.expectedRevision");
      if (payload.mode !== "append" && payload.mode !== "replace") {
        fail("invalid_request", "$.payload.mode must be append or replace");
      }
      expectString(payload.content, "$.payload.content", {
        nonempty: true,
        maxBytes: MAX_TEXT_BYTES,
      });
      return;
    case "verify_annotation":
      validateLibraryAttachmentPayload(
        payload,
        "$.payload",
        ["libraryId", "attachmentKey", "annotationKey"],
      );
      expectIdentifier(payload.annotationKey, "$.payload.annotationKey");
      return;
  }
}

function validateAuthorization(value: unknown): void {
  const authorization = expectRecord(value, "$.authorization");
  expectOnlyKeys(authorization, ["kind", "scope"], "$.authorization");
  if (
    authorization.kind !== "explicit_request" &&
    authorization.kind !== "approved_proposal"
  ) {
    fail("permission_denied", "$.authorization.kind is not recognized");
  }
  try {
    expectString(authorization.scope, "$.authorization.scope", {
      nonempty: true,
      maxBytes: MAX_AUTHORIZATION_SCOPE_BYTES,
    });
  } catch (error) {
    if (error instanceof ProtocolValidationError && error.code === "invalid_request") {
      fail("permission_denied", error.message);
    }
    throw error;
  }
}

function serializedSize(value: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return fail("invalid_request", "Request must be serializable JSON");
  }
  if (serialized === undefined) return fail("invalid_request", "Request must be serializable JSON");
  return utf8Length(serialized);
}

export function validateProtocolRequest(value: unknown): ProtocolRequest {
  if (serializedSize(value) > MAX_REQUEST_BYTES) {
    fail("too_large", `Request exceeds ${MAX_REQUEST_BYTES} UTF-8 bytes`);
  }
  const request = expectRecord(value, "$");
  expectOnlyKeys(
    request,
    ["protocolVersion", "operationId", "operation", "profileId", "authorization", "payload"],
    "$",
  );

  if (!hasOwn(request, "protocolVersion") || typeof request.protocolVersion !== "number") {
    fail("invalid_request", "$.protocolVersion must be a number");
  }
  if (request.protocolVersion !== PROTOCOL_VERSION) {
    fail("unsupported_version", `Only protocolVersion ${PROTOCOL_VERSION} is supported`);
  }
  if (
    typeof request.operationId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request.operationId)
  ) {
    fail("invalid_request", "$.operationId is not a safe opaque ID");
  }
  if (typeof request.operation !== "string") {
    fail("invalid_request", "$.operation must be a string");
  }
  if (!(OPERATION_NAMES as readonly string[]).includes(request.operation)) {
    fail("unsupported_operation", "$.operation is not supported");
  }
  const operation = request.operation as OperationName;

  if (operation === "connection_status") {
    if (hasOwn(request, "profileId")) expectIdentifier(request.profileId, "$.profileId");
  } else {
    expectIdentifier(request.profileId, "$.profileId");
  }

  if (isMutationOperation(operation)) {
    if (!hasOwn(request, "authorization")) {
      fail("permission_denied", "Mutation requests require authorization metadata");
    }
    validateAuthorization(request.authorization);
  } else if (hasOwn(request, "authorization")) {
    fail("invalid_request", "Authorization metadata is only valid for mutations");
  }

  validatePayload(operation, request.payload);
  return value as ProtocolRequest;
}

export function parseProtocolRequest(input: string | Uint8Array): ProtocolRequest {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  if (bytes.byteLength > MAX_REQUEST_BYTES) {
    fail("too_large", `Request exceeds ${MAX_REQUEST_BYTES} UTF-8 bytes`);
  }
  let text: string;
  try {
    text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    return fail("invalid_request", "Request is not valid UTF-8");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return fail("invalid_request", "Request is not valid JSON");
  }
  return validateProtocolRequest(value);
}
