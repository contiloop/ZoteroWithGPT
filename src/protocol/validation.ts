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
  MAX_URL_BYTES,
  NATIVE_ANNOTATION_COLORS,
  OPERATION_NAMES,
  isMutationOperation,
} from "./constants.js";
import {
  PROTOCOL_VERSION,
  type ArxivUrlReference,
  type EnsureArxivPdfResult,
  type OperationName,
  type ProtocolErrorCode,
  type ProtocolRequest,
  type ProtocolResponse,
  type ResultFor,
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

function expectPositiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail("invalid_request", `${path} must be a positive safe integer`);
  }
  return value as number;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("invalid_request", `${path} must be a boolean`);
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail("invalid_request", `${path} must be an array`);
  return value;
}

const MODERN_ARXIV_ID = /^(\d{2})(\d{2})\.(\d{4,5})$/u;
const LEGACY_ARXIV_ID = /^([a-z][a-z0-9]*(?:[.-][a-z0-9]+)*)\/(\d{2})(\d{2})(\d{3})$/u;

/** Checks canonical unversioned modern and legacy arXiv identifiers. */
export function isValidArxivId(value: string): boolean {
  const modern = MODERN_ARXIV_ID.exec(value);
  if (modern !== null) {
    const month = Number(modern[2]);
    const serial = Number(modern[3]);
    return month >= 1 && month <= 12 && serial >= 1;
  }
  const legacy = LEGACY_ARXIV_ID.exec(value);
  if (legacy === null) return false;
  const month = Number(legacy[3]);
  const serial = Number(legacy[4]);
  return month >= 1 && month <= 12 && serial >= 1;
}

function expectArxivId(value: unknown, path: string): string {
  const arxivId = expectString(value, path, { nonempty: true, maxBytes: MAX_URL_BYTES });
  if (!isValidArxivId(arxivId)) {
    fail("invalid_request", `${path} must be a canonical unversioned arXiv identifier`);
  }
  return arxivId;
}

function validateArticleIdentity(value: unknown, path: string): Record<string, unknown> {
  const identity = expectRecord(value, path);
  expectOnlyKeys(identity, ["arxivId", "version"], path);
  expectArxivId(identity.arxivId, `${path}.arxivId`);
  expectPositiveInteger(identity.version, `${path}.version`);
  return identity;
}

/** Parses only official HTTPS arXiv abstract/PDF URLs; it performs no network access. */
export function parseArxivUrl(value: string): ArxivUrlReference {
  if (utf8Length(value) > MAX_URL_BYTES) {
    fail("too_large", `arXiv URL exceeds ${MAX_URL_BYTES} UTF-8 bytes`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail("invalid_request", "arXiv URL is malformed");
  }
  if (
    parsed.protocol !== "https:" ||
    (parsed.hostname !== "arxiv.org" && parsed.hostname !== "www.arxiv.org") ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    fail("invalid_request", "arXiv URL must be an uncredentialed official HTTPS URL");
  }

  const pathMatch = /^\/(abs|pdf)\/(.+?)\/?$/u.exec(parsed.pathname);
  if (pathMatch === null || pathMatch[2] === undefined || pathMatch[2].includes("%")) {
    fail("invalid_request", "arXiv URL must identify an abstract or PDF");
  }
  let reference = pathMatch[2];
  if (pathMatch[1] === "pdf" && reference.endsWith(".pdf")) {
    reference = reference.slice(0, -4);
  } else if (pathMatch[1] === "abs" && reference.endsWith(".pdf")) {
    fail("invalid_request", "An arXiv abstract URL must not use a PDF suffix");
  }

  const versionMatch = /v([1-9][0-9]*)$/u.exec(reference);
  let version: number | undefined;
  let arxivId = reference;
  if (versionMatch !== null) {
    version = Number(versionMatch[1]);
    if (!Number.isSafeInteger(version)) {
      fail("invalid_request", "arXiv URL version must be a positive safe integer");
    }
    arxivId = reference.slice(0, versionMatch.index);
  } else if (/v[0-9]+$/u.test(reference)) {
    fail("invalid_request", "arXiv URL version must be positive and canonical");
  }
  expectArxivId(arxivId, "arXiv URL identifier");
  return version === undefined ? { arxivId } : { arxivId, version };
}

export function arxivAbstractUrl(identity: { arxivId: string; version: number }): string {
  validateArticleIdentity(identity, "arXiv identity");
  return `https://arxiv.org/abs/${identity.arxivId}v${String(identity.version)}`;
}

export function arxivPdfUrl(identity: { arxivId: string; version: number }): string {
  validateArticleIdentity(identity, "arXiv identity");
  return `https://arxiv.org/pdf/${identity.arxivId}v${String(identity.version)}`;
}

function validateImportSelection(value: unknown, path: string): Record<string, unknown> {
  const selection = expectRecord(value, path);
  if (selection.kind === "create") {
    expectOnlyKeys(selection, ["kind"], path);
    return selection;
  }
  if (selection.kind === "attach") {
    expectOnlyKeys(selection, ["kind", "itemKey", "expectedItemRevision"], path);
    expectIdentifier(selection.itemKey, `${path}.itemKey`);
    expectIdentifier(selection.expectedItemRevision, `${path}.expectedItemRevision`);
    return selection;
  }
  if (selection.kind === "reuse") {
    expectOnlyKeys(
      selection,
      ["kind", "itemKey", "attachmentKey", "expectedFingerprint"],
      path,
    );
    expectIdentifier(selection.itemKey, `${path}.itemKey`);
    expectIdentifier(selection.attachmentKey, `${path}.attachmentKey`);
    expectIdentifier(selection.expectedFingerprint, `${path}.expectedFingerprint`);
    return selection;
  }
  return fail("invalid_request", `${path}.kind is not a supported import selection`);
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
    case "inspect_arxiv": {
      expectOnlyKeys(payload, ["url"], "$.payload");
      const url = expectString(payload.url, "$.payload.url", {
        nonempty: true,
        maxBytes: MAX_URL_BYTES,
      });
      parseArxivUrl(url);
      return;
    }
    case "ensure_arxiv_pdf":
      expectOnlyKeys(payload, ["source", "inspectionToken", "selection"], "$.payload");
      validateArticleIdentity(payload.source, "$.payload.source");
      expectIdentifier(payload.inspectionToken, "$.payload.inspectionToken");
      validateImportSelection(payload.selection, "$.payload.selection");
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

function expectIsoTimestamp(value: unknown, path: string): string {
  const timestamp = expectString(value, path, { nonempty: true, maxBytes: 64 });
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    fail("invalid_request", `${path} must be an ISO UTC timestamp`);
  }
  return timestamp;
}

function validateArxivSource(value: unknown, path: string): Record<string, unknown> {
  const source = expectRecord(value, path);
  expectOnlyKeys(
    source,
    ["arxivId", "version", "abstractUrl", "pdfUrl", "metadata"],
    path,
  );
  const arxivId = expectArxivId(source.arxivId, `${path}.arxivId`);
  const version = expectPositiveInteger(source.version, `${path}.version`);
  const abstractUrl = expectString(source.abstractUrl, `${path}.abstractUrl`, {
    nonempty: true,
    maxBytes: MAX_URL_BYTES,
  });
  const pdfUrl = expectString(source.pdfUrl, `${path}.pdfUrl`, {
    nonempty: true,
    maxBytes: MAX_URL_BYTES,
  });
  const expectedIdentity = { arxivId, version };
  if (abstractUrl !== arxivAbstractUrl(expectedIdentity)) {
    fail("invalid_request", `${path}.abstractUrl is not the server-constructed source URL`);
  }
  if (pdfUrl !== arxivPdfUrl(expectedIdentity)) {
    fail("invalid_request", `${path}.pdfUrl is not the server-constructed PDF URL`);
  }

  const metadata = expectRecord(source.metadata, `${path}.metadata`);
  expectOnlyKeys(
    metadata,
    ["title", "authors", "published", "updated", "abstract", "doi"],
    `${path}.metadata`,
  );
  expectString(metadata.title, `${path}.metadata.title`, {
    nonempty: true,
    maxBytes: MAX_QUERY_BYTES,
  });
  const authors = expectArray(metadata.authors, `${path}.metadata.authors`);
  if (authors.length === 0) fail("invalid_request", `${path}.metadata.authors must not be empty`);
  authors.forEach((author, index) =>
    expectString(author, `${path}.metadata.authors[${index}]`, {
      nonempty: true,
      maxBytes: MAX_QUERY_BYTES,
    }),
  );
  const published = expectIsoTimestamp(metadata.published, `${path}.metadata.published`);
  const updated = expectIsoTimestamp(metadata.updated, `${path}.metadata.updated`);
  if (Date.parse(updated) < Date.parse(published)) {
    fail("invalid_request", `${path}.metadata.updated must not precede published`);
  }
  expectString(metadata.abstract, `${path}.metadata.abstract`, { maxBytes: MAX_TEXT_BYTES });
  if (hasOwn(metadata, "doi")) {
    expectString(metadata.doi, `${path}.metadata.doi`, {
      nonempty: true,
      maxBytes: MAX_URL_BYTES,
    });
  }
  return source;
}

interface ValidatedCandidateAttachment {
  attachmentKey: string;
  fingerprint: string | null;
  version: number | null;
  identity: "verified" | "unverified";
}

interface ValidatedCandidate {
  itemKey: string;
  itemRevision: string;
  attachments: ValidatedCandidateAttachment[];
}

function validateCandidateAttachment(
  value: unknown,
  path: string,
): ValidatedCandidateAttachment {
  const attachment = expectRecord(value, path);
  expectOnlyKeys(
    attachment,
    ["attachmentKey", "fingerprint", "version", "identity"],
    path,
  );
  const attachmentKey = expectIdentifier(attachment.attachmentKey, `${path}.attachmentKey`);
  let fingerprint: string | null;
  if (attachment.fingerprint === null) fingerprint = null;
  else fingerprint = expectIdentifier(attachment.fingerprint, `${path}.fingerprint`);
  let version: number | null;
  if (attachment.version === null) version = null;
  else version = expectPositiveInteger(attachment.version, `${path}.version`);
  if (attachment.identity !== "verified" && attachment.identity !== "unverified") {
    fail("invalid_request", `${path}.identity must be verified or unverified`);
  }
  if (attachment.identity === "verified" && version === null) {
    fail("invalid_request", `${path}.version is required for verified arXiv identity`);
  }
  return { attachmentKey, fingerprint, version, identity: attachment.identity };
}

function validateArxivCandidate(value: unknown, path: string): ValidatedCandidate {
  const candidate = expectRecord(value, path);
  expectOnlyKeys(candidate, ["itemKey", "itemRevision", "title", "attachments"], path);
  const itemKey = expectIdentifier(candidate.itemKey, `${path}.itemKey`);
  const itemRevision = expectIdentifier(candidate.itemRevision, `${path}.itemRevision`);
  expectString(candidate.title, `${path}.title`, {
    nonempty: true,
    maxBytes: MAX_QUERY_BYTES,
  });
  const attachments = expectArray(candidate.attachments, `${path}.attachments`).map(
    (attachment, index) =>
      validateCandidateAttachment(attachment, `${path}.attachments[${index}]`),
  );
  return { itemKey, itemRevision, attachments };
}

function validateInspectArxivResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(
    result,
    ["source", "libraryId", "candidates", "decision", "reason", "inspectionToken", "selection"],
    path,
  );
  const source = validateArxivSource(result.source, `${path}.source`);
  const sourceVersion = source.version as number;
  expectIdentifier(result.libraryId, `${path}.libraryId`);
  const candidates = expectArray(result.candidates, `${path}.candidates`).map((candidate, index) =>
    validateArxivCandidate(candidate, `${path}.candidates[${index}]`),
  );
  if (
    result.decision !== "create" &&
    result.decision !== "attach" &&
    result.decision !== "reuse" &&
    result.decision !== "needs_choice"
  ) {
    fail("invalid_request", `${path}.decision is not supported`);
  }
  expectString(result.reason, `${path}.reason`, { nonempty: true, maxBytes: MAX_TEXT_BYTES });
  expectIdentifier(result.inspectionToken, `${path}.inspectionToken`);

  const expectedDecision = (() => {
    if (candidates.length === 0) return "create" as const;
    if (candidates.length !== 1) return "needs_choice" as const;
    const candidate = candidates[0];
    if (candidate === undefined) return "needs_choice" as const;
    if (candidate.attachments.length === 0) return "attach" as const;
    if (candidate.attachments.length !== 1) return "needs_choice" as const;
    const attachment = candidate.attachments[0];
    return attachment !== undefined &&
      attachment.identity === "verified" &&
      attachment.version === sourceVersion &&
      attachment.fingerprint !== null
      ? "reuse" as const
      : "needs_choice" as const;
  })();
  if (result.decision !== expectedDecision) {
    fail(
      "invalid_request",
      `${path}.decision must be ${expectedDecision} for the complete candidate snapshot`,
    );
  }

  const hasSelection = hasOwn(result, "selection");
  if (result.decision === "needs_choice") {
    if (hasSelection) fail("invalid_request", `${path}.selection must be omitted for needs_choice`);
  } else {
    if (!hasSelection) fail("invalid_request", `${path}.selection is required for a decision`);
    const selection = validateImportSelection(result.selection, `${path}.selection`);
    if (selection.kind !== result.decision) {
      fail("invalid_request", `${path}.selection.kind must match decision`);
    }

    if (result.decision !== "create") {
      const candidate = candidates[0];
      if (candidate === undefined || selection.itemKey !== candidate.itemKey) {
        fail("invalid_request", `${path}.selection does not identify the candidate snapshot`);
      }
      if (selection.kind === "attach") {
        if (selection.expectedItemRevision !== candidate.itemRevision) {
          fail("invalid_request", `${path}.selection has a stale item revision`);
        }
      } else if (selection.kind === "reuse") {
        const attachment = candidate.attachments.find(
          (entry) => entry.attachmentKey === selection.attachmentKey,
        );
        if (
          attachment === undefined ||
          attachment.identity !== "verified" ||
          attachment.version !== sourceVersion ||
          attachment.fingerprint !== selection.expectedFingerprint
        ) {
          fail("invalid_request", `${path}.selection does not match a verified source PDF`);
        }
      }
    }
  }

}

function validateEnsureArxivResult(
  value: unknown,
  path: string,
  requiredCompletion?: "ready" | "item_only",
): EnsureArxivPdfResult {
  const result = expectRecord(value, path);
  expectOnlyKeys(
    result,
    [
      "source",
      "libraryId",
      "completion",
      "itemKey",
      "itemAction",
      "attachmentKey",
      "attachmentFingerprint",
      "pdfAction",
      "deepLink",
    ],
    path,
  );
  validateArticleIdentity(result.source, `${path}.source`);
  expectIdentifier(result.libraryId, `${path}.libraryId`);
  expectIdentifier(result.itemKey, `${path}.itemKey`);
  if (result.itemAction !== "created" && result.itemAction !== "reused") {
    fail("invalid_request", `${path}.itemAction must be created or reused`);
  }
  expectString(result.deepLink, `${path}.deepLink`, {
    nonempty: true,
    maxBytes: MAX_URL_BYTES,
  });
  if (result.completion === "ready") {
    if (requiredCompletion === "item_only") {
      fail("invalid_request", `${path}.completion must be item_only`);
    }
    expectIdentifier(result.attachmentKey, `${path}.attachmentKey`);
    expectIdentifier(result.attachmentFingerprint, `${path}.attachmentFingerprint`);
    if (result.pdfAction !== "downloaded" && result.pdfAction !== "reused") {
      fail("invalid_request", `${path}.pdfAction must be downloaded or reused when ready`);
    }
  } else if (result.completion === "item_only") {
    if (requiredCompletion === "ready") {
      fail("invalid_request", `${path}.completion must be ready`);
    }
    if (result.attachmentKey !== null || result.attachmentFingerprint !== null) {
      fail("invalid_request", `${path} item_only attachment evidence must be null`);
    }
    if (result.pdfAction !== "none") {
      fail("invalid_request", `${path}.pdfAction must be none when item_only`);
    }
  } else {
    fail("invalid_request", `${path}.completion must be ready or item_only`);
  }
  return value as EnsureArxivPdfResult;
}

export function isEnsureArxivReadyResult(value: unknown): value is EnsureArxivPdfResult & {
  completion: "ready";
} {
  try {
    validateEnsureArxivResult(value, "ensure_arxiv_pdf data", "ready");
    return true;
  } catch (error) {
    if (error instanceof ProtocolValidationError) return false;
    throw error;
  }
}

export function isEnsureArxivItemOnlyResult(value: unknown): value is EnsureArxivPdfResult & {
  completion: "item_only";
} {
  try {
    validateEnsureArxivResult(value, "ensure_arxiv_pdf data", "item_only");
    return true;
  } catch (error) {
    if (error instanceof ProtocolValidationError) return false;
    throw error;
  }
}

function validateVerification(value: unknown, path: string): Record<string, unknown> {
  const verification = expectRecord(value, path);
  expectOnlyKeys(verification, ["storage", "viewer"], path);
  const states = ["not_applicable", "not_checked", "confirmed", "failed"];
  if (!states.includes(verification.storage as string)) {
    fail("invalid_request", `${path}.storage is not a verification state`);
  }
  if (!states.includes(verification.viewer as string)) {
    fail("invalid_request", `${path}.viewer is not a verification state`);
  }
  return verification;
}

function validateProtocolError(value: unknown, path: string): Record<string, unknown> {
  const error = expectRecord(value, path);
  expectOnlyKeys(error, ["code", "message", "retryable"], path);
  const codes: readonly ProtocolErrorCode[] = [
    "invalid_request",
    "unsupported_version",
    "unsupported_operation",
    "permission_denied",
    "not_connected",
    "not_found",
    "ambiguous_target",
    "unresolved_anchor",
    "stale_attachment",
    "conflict",
    "duplicate_id_mismatch",
    "unsupported_capability",
    "too_large",
    "storage_error",
    "verification_failed",
    "unknown_outcome",
  ];
  if (!codes.includes(error.code as ProtocolErrorCode)) {
    fail("invalid_request", `${path}.code is not supported`);
  }
  expectString(error.message, `${path}.message`, { nonempty: true, maxBytes: MAX_TEXT_BYTES });
  expectBoolean(error.retryable, `${path}.retryable`);
  return error;
}

function assertUniqueStrings(values: string[], path: string): void {
  if (new Set(values).size !== values.length) {
    fail("invalid_request", `${path} must not contain duplicates`);
  }
}

function validateConnectionStatusResult(value: unknown, path: string): void {
  const status = expectRecord(value, path);
  expectOnlyKeys(
    status,
    ["protocolVersion", "pluginVersion", "zoteroVersion", "profile", "enabled", "capabilities", "transport"],
    path,
  );
  if (status.protocolVersion !== PROTOCOL_VERSION) {
    fail("unsupported_version", `${path}.protocolVersion is not supported`);
  }
  expectString(status.pluginVersion, `${path}.pluginVersion`, { nonempty: true });
  expectString(status.zoteroVersion, `${path}.zoteroVersion`, { nonempty: true });
  const profile = expectRecord(status.profile, `${path}.profile`);
  expectOnlyKeys(profile, ["id", "name"], `${path}.profile`);
  expectIdentifier(profile.id, `${path}.profile.id`);
  if (hasOwn(profile, "name")) {
    expectString(profile.name, `${path}.profile.name`, { nonempty: true });
  }
  expectBoolean(status.enabled, `${path}.enabled`);

  const capabilities = expectRecord(status.capabilities, `${path}.capabilities`);
  expectOnlyKeys(
    capabilities,
    ["operations", "annotationTypes", "annotationColors", "maxRequestBytes", "maxTextBytes"],
    `${path}.capabilities`,
  );
  const operations = expectArray(capabilities.operations, `${path}.capabilities.operations`).map(
    (operation, index) => {
      const name = expectString(operation, `${path}.capabilities.operations[${index}]`, {
        nonempty: true,
      });
      if (!(OPERATION_NAMES as readonly string[]).includes(name)) {
        fail("invalid_request", `${path}.capabilities.operations[${index}] is unknown`);
      }
      return name;
    },
  );
  assertUniqueStrings(operations, `${path}.capabilities.operations`);
  const annotationTypes = expectArray(
    capabilities.annotationTypes,
    `${path}.capabilities.annotationTypes`,
  ).map((type, index) => {
    if (type !== "highlight" && type !== "note") {
      fail("invalid_request", `${path}.capabilities.annotationTypes[${index}] is unsupported`);
    }
    return type;
  });
  assertUniqueStrings(annotationTypes, `${path}.capabilities.annotationTypes`);
  const colors = expectArray(
    capabilities.annotationColors,
    `${path}.capabilities.annotationColors`,
  ).map((color, index) => {
    const value = expectString(color, `${path}.capabilities.annotationColors[${index}]`);
    if (!(NATIVE_ANNOTATION_COLORS as readonly string[]).includes(value)) {
      fail("invalid_request", `${path}.capabilities.annotationColors[${index}] is unsupported`);
    }
    return value;
  });
  assertUniqueStrings(colors, `${path}.capabilities.annotationColors`);
  expectPositiveInteger(capabilities.maxRequestBytes, `${path}.capabilities.maxRequestBytes`);
  expectPositiveInteger(capabilities.maxTextBytes, `${path}.capabilities.maxTextBytes`);

  const transport = expectRecord(status.transport, `${path}.transport`);
  expectOnlyKeys(transport, ["kind", "description"], `${path}.transport`);
  if (
    transport.kind !== "http" &&
    transport.kind !== "native_messaging" &&
    transport.kind !== "custom"
  ) {
    fail("invalid_request", `${path}.transport.kind is unsupported`);
  }
  expectString(transport.description, `${path}.transport.description`, { nonempty: true });
}

function validateAttachmentSummary(value: unknown, path: string): void {
  const attachment = expectRecord(value, path);
  expectOnlyKeys(attachment, ["attachmentKey", "title", "contentType", "fingerprint"], path);
  expectIdentifier(attachment.attachmentKey, `${path}.attachmentKey`);
  expectString(attachment.title, `${path}.title`);
  expectString(attachment.contentType, `${path}.contentType`, { nonempty: true });
  if (hasOwn(attachment, "fingerprint")) {
    expectIdentifier(attachment.fingerprint, `${path}.fingerprint`);
  }
}

function validateSearchPapersResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(result, ["matches"], path);
  expectArray(result.matches, `${path}.matches`).forEach((entry, index) => {
    const match = expectRecord(entry, `${path}.matches[${index}]`);
    expectOnlyKeys(
      match,
      ["libraryId", "itemKey", "title", "creators", "year", "attachments"],
      `${path}.matches[${index}]`,
    );
    expectIdentifier(match.libraryId, `${path}.matches[${index}].libraryId`);
    expectIdentifier(match.itemKey, `${path}.matches[${index}].itemKey`);
    expectString(match.title, `${path}.matches[${index}].title`);
    expectArray(match.creators, `${path}.matches[${index}].creators`).forEach(
      (creator, creatorIndex) =>
        expectString(creator, `${path}.matches[${index}].creators[${creatorIndex}]`),
    );
    if (hasOwn(match, "year") && !Number.isSafeInteger(match.year)) {
      fail("invalid_request", `${path}.matches[${index}].year must be a safe integer`);
    }
    expectArray(match.attachments, `${path}.matches[${index}].attachments`).forEach(
      (attachment, attachmentIndex) =>
        validateAttachmentSummary(
          attachment,
          `${path}.matches[${index}].attachments[${attachmentIndex}]`,
        ),
    );
  });
}

function validatePassageCandidate(value: unknown, path: string): void {
  const candidate = expectRecord(value, path);
  expectOnlyKeys(candidate, ["exact", "prefix", "suffix"], path);
  expectString(candidate.exact, `${path}.exact`, { nonempty: true, maxBytes: MAX_EXCERPT_BYTES });
  if (hasOwn(candidate, "prefix")) {
    expectString(candidate.prefix, `${path}.prefix`, { maxBytes: MAX_EXCERPT_BYTES });
  }
  if (hasOwn(candidate, "suffix")) {
    expectString(candidate.suffix, `${path}.suffix`, { maxBytes: MAX_EXCERPT_BYTES });
  }
}

function validateRegionCandidate(value: unknown, path: string): void {
  const candidate = expectRecord(value, path);
  expectOnlyKeys(candidate, ["rectangles", "selectedText"], path);
  validateRectangles(candidate.rectangles, `${path}.rectangles`);
  if (hasOwn(candidate, "selectedText")) {
    expectString(candidate.selectedText, `${path}.selectedText`, {
      nonempty: true,
      maxBytes: MAX_EXCERPT_BYTES,
    });
  }
}

function validateReadPdfResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(result, ["attachmentFingerprint", "attachmentRevision", "pages"], path);
  expectIdentifier(result.attachmentFingerprint, `${path}.attachmentFingerprint`);
  expectIdentifier(result.attachmentRevision, `${path}.attachmentRevision`);
  expectArray(result.pages, `${path}.pages`).forEach((entry, index) => {
    const page = expectRecord(entry, `${path}.pages[${index}]`);
    expectOnlyKeys(
      page,
      ["pageIndex", "pageLabel", "text", "passageCandidates", "regionCandidates"],
      `${path}.pages[${index}]`,
    );
    expectNonnegativeInteger(page.pageIndex, `${path}.pages[${index}].pageIndex`);
    expectString(page.pageLabel, `${path}.pages[${index}].pageLabel`, { nonempty: true });
    expectString(page.text, `${path}.pages[${index}].text`);
    expectArray(page.passageCandidates, `${path}.pages[${index}].passageCandidates`).forEach(
      (candidate, candidateIndex) =>
        validatePassageCandidate(
          candidate,
          `${path}.pages[${index}].passageCandidates[${candidateIndex}]`,
        ),
    );
    expectArray(page.regionCandidates, `${path}.pages[${index}].regionCandidates`).forEach(
      (candidate, candidateIndex) =>
        validateRegionCandidate(
          candidate,
          `${path}.pages[${index}].regionCandidates[${candidateIndex}]`,
        ),
    );
  });
}

function validateNativeAnnotation(value: unknown, path: string): void {
  const annotation = expectRecord(value, path);
  expectOnlyKeys(
    annotation,
    ["annotationKey", "revision", "type", "anchor", "text", "comment", "color", "deepLink"],
    path,
  );
  expectIdentifier(annotation.annotationKey, `${path}.annotationKey`);
  expectIdentifier(annotation.revision, `${path}.revision`);
  if (annotation.type !== "highlight" && annotation.type !== "note") {
    fail("invalid_request", `${path}.type must be highlight or note`);
  }
  validateResolvedAnchor(annotation.anchor, `${path}.anchor`);
  if (hasOwn(annotation, "text")) expectString(annotation.text, `${path}.text`);
  expectString(annotation.comment, `${path}.comment`);
  if (hasOwn(annotation, "color")) {
    const color = expectString(annotation.color, `${path}.color`);
    if (!(NATIVE_ANNOTATION_COLORS as readonly string[]).includes(color)) {
      fail("invalid_request", `${path}.color is unsupported`);
    }
  }
  expectString(annotation.deepLink, `${path}.deepLink`, { nonempty: true });
}

function validateListAnnotationsResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(result, ["annotations"], path);
  expectArray(result.annotations, `${path}.annotations`).forEach((annotation, index) =>
    validateNativeAnnotation(annotation, `${path}.annotations[${index}]`),
  );
}

function validateNoteSummary(value: unknown, path: string): void {
  const note = expectRecord(value, path);
  expectOnlyKeys(note, ["noteKey", "parentItemKey", "title", "revision"], path);
  expectIdentifier(note.noteKey, `${path}.noteKey`);
  expectIdentifier(note.parentItemKey, `${path}.parentItemKey`);
  expectString(note.title, `${path}.title`);
  expectIdentifier(note.revision, `${path}.revision`);
}

function validateListNotesResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(result, ["notes"], path);
  expectArray(result.notes, `${path}.notes`).forEach((note, index) =>
    validateNoteSummary(note, `${path}.notes[${index}]`),
  );
}

function validateReadNoteResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(result, ["parentItemKey", "noteKey", "revision", "content", "deepLink"], path);
  expectIdentifier(result.parentItemKey, `${path}.parentItemKey`);
  expectIdentifier(result.noteKey, `${path}.noteKey`);
  expectIdentifier(result.revision, `${path}.revision`);
  expectString(result.content, `${path}.content`);
  expectString(result.deepLink, `${path}.deepLink`, { nonempty: true });
}

function validateAnchorCandidate(value: unknown, path: string): void {
  const candidate = expectRecord(value, path);
  expectOnlyKeys(candidate, ["anchor", "reason"], path);
  validateResolvedAnchor(candidate.anchor, `${path}.anchor`);
  expectString(candidate.reason, `${path}.reason`, { nonempty: true });
}

function validateResolveAnchorResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  if (result.status === "resolved") {
    expectOnlyKeys(result, ["status", "anchor"], path);
    validateResolvedAnchor(result.anchor, `${path}.anchor`);
    return;
  }
  if (result.status === "unresolved") {
    expectOnlyKeys(result, ["status", "reason", "candidates"], path);
    expectString(result.reason, `${path}.reason`, { nonempty: true });
    expectArray(result.candidates, `${path}.candidates`).forEach((candidate, index) =>
      validateAnchorCandidate(candidate, `${path}.candidates[${index}]`),
    );
    return;
  }
  fail("invalid_request", `${path}.status must be resolved or unresolved`);
}

function validateSavedAnnotationSnapshot(value: unknown, path: string): void {
  const saved = expectRecord(value, path);
  expectOnlyKeys(saved, ["pageIndex", "pageLabel", "rectangles", "selectedText", "comment"], path);
  expectNonnegativeInteger(saved.pageIndex, `${path}.pageIndex`);
  expectString(saved.pageLabel, `${path}.pageLabel`, { nonempty: true });
  validateRectangles(saved.rectangles, `${path}.rectangles`);
  if (hasOwn(saved, "selectedText")) {
    expectString(saved.selectedText, `${path}.selectedText`, { nonempty: true });
  }
  expectString(saved.comment, `${path}.comment`);
}

function validateCreateAnnotationResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(result, ["annotationKey", "revision", "deepLink", "saved"], path);
  expectIdentifier(result.annotationKey, `${path}.annotationKey`);
  expectIdentifier(result.revision, `${path}.revision`);
  expectString(result.deepLink, `${path}.deepLink`, { nonempty: true });
  validateSavedAnnotationSnapshot(result.saved, `${path}.saved`);
}

function validateUpdateAnnotationResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(result, ["annotationKey", "revision", "comment", "deepLink"], path);
  expectIdentifier(result.annotationKey, `${path}.annotationKey`);
  expectIdentifier(result.revision, `${path}.revision`);
  expectString(result.comment, `${path}.comment`);
  expectString(result.deepLink, `${path}.deepLink`, { nonempty: true });
}

function validateNoteMutationResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(result, ["noteKey", "revision", "content", "deepLink"], path);
  expectIdentifier(result.noteKey, `${path}.noteKey`);
  expectIdentifier(result.revision, `${path}.revision`);
  expectString(result.content, `${path}.content`);
  expectString(result.deepLink, `${path}.deepLink`, { nonempty: true });
}

function validateVerificationDetail(value: unknown, path: string): void {
  const detail = expectRecord(value, path);
  expectOnlyKeys(detail, ["confirmed", "description"], path);
  expectBoolean(detail.confirmed, `${path}.confirmed`);
  expectString(detail.description, `${path}.description`);
}

function validateVerifyAnnotationResult(value: unknown, path: string): void {
  const result = expectRecord(value, path);
  expectOnlyKeys(result, ["annotationKey", "storageEvidence", "viewerEvidence"], path);
  expectIdentifier(result.annotationKey, `${path}.annotationKey`);
  validateVerificationDetail(result.storageEvidence, `${path}.storageEvidence`);
  validateVerificationDetail(result.viewerEvidence, `${path}.viewerEvidence`);
}

function validateOperationResult(operation: OperationName, value: unknown, path: string): void {
  switch (operation) {
    case "connection_status":
      return validateConnectionStatusResult(value, path);
    case "search_papers":
      return validateSearchPapersResult(value, path);
    case "read_pdf":
      return validateReadPdfResult(value, path);
    case "list_annotations":
      return validateListAnnotationsResult(value, path);
    case "list_notes":
      return validateListNotesResult(value, path);
    case "read_note":
      return validateReadNoteResult(value, path);
    case "resolve_anchor":
      return validateResolveAnchorResult(value, path);
    case "create_annotation":
      return validateCreateAnnotationResult(value, path);
    case "update_annotation":
      return validateUpdateAnnotationResult(value, path);
    case "create_note":
    case "update_note":
      return validateNoteMutationResult(value, path);
    case "verify_annotation":
      return validateVerifyAnnotationResult(value, path);
    case "inspect_arxiv":
      return validateInspectArxivResult(value, path);
    case "ensure_arxiv_pdf":
      validateEnsureArxivResult(value, path, "ready");
      return;
  }
}

/** Validates a response against the operation the caller originally submitted. */
export function validateProtocolResponse<O extends OperationName>(
  operation: O,
  value: unknown,
): ProtocolResponse<ResultFor<O>> {
  if (!(OPERATION_NAMES as readonly string[]).includes(operation)) {
    fail("unsupported_operation", "Response operation is not supported");
  }
  const result = expectRecord(value, "$response");
  expectOnlyKeys(
    result,
    ["protocolVersion", "operationId", "state", "data", "error", "verification"],
    "$response",
  );
  if (result.protocolVersion !== PROTOCOL_VERSION) {
    fail("unsupported_version", `Only protocolVersion ${PROTOCOL_VERSION} is supported`);
  }
  if (
    typeof result.operationId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(result.operationId)
  ) {
    fail("invalid_request", "$response.operationId is not a safe opaque ID");
  }
  const states = ["queued", "running", "succeeded", "rejected", "failed", "indeterminate"];
  if (!states.includes(result.state as string)) {
    fail("invalid_request", "$response.state is not supported");
  }
  const verification = validateVerification(result.verification, "$response.verification");

  if (result.state === "queued" || result.state === "running") {
    if (result.data !== null || result.error !== null) {
      fail("invalid_request", `${result.state} responses require null data and error`);
    }
  } else if (result.state === "succeeded") {
    if (result.error !== null) fail("invalid_request", "Succeeded responses require null error");
    validateOperationResult(operation, result.data, "$response.data");
    if (operation === "inspect_arxiv") {
      if (verification.storage !== "not_applicable" || verification.viewer !== "not_applicable") {
        fail("invalid_request", "inspect_arxiv does not produce storage or viewer evidence");
      }
    }
    if (operation === "ensure_arxiv_pdf") {
      if (verification.storage !== "confirmed" || verification.viewer !== "not_checked") {
        fail("invalid_request", "A ready arXiv import requires confirmed storage readback");
      }
    }
  } else {
    const error = validateProtocolError(result.error, "$response.error");
    if (result.state === "indeterminate" && error.code !== "unknown_outcome") {
      fail("invalid_request", "Indeterminate responses require unknown_outcome");
    }
    if (result.data !== null) {
      if (
        result.state !== "failed" ||
        operation !== "ensure_arxiv_pdf" ||
        error.code !== "storage_error" ||
        verification.storage !== "confirmed" ||
        verification.viewer !== "not_checked"
      ) {
        fail("invalid_request", "Only a confirmed item-only arXiv failure may retain data");
      }
      validateEnsureArxivResult(result.data, "$response.data", "item_only");
    }
  }
  return value as ProtocolResponse<ResultFor<O>>;
}
