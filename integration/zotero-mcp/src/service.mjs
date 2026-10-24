import {
  appendNoteContent,
  isSafeNativeNoteContent,
  safeNativeNoteContent,
} from "../../../dist/adapters/zotero/index.js";
import {
  MAX_TEXT_BYTES,
  canonicalRequestBytes,
  validateProtocolRequest,
  validateProtocolResponse,
} from "../../../dist/protocol/index.js";
import {
  ACTIVE_PROTOCOL_OPERATIONS,
  prepareZoteroMcpToolCall,
  validateZoteroMcpResult,
} from "../contracts.mjs";
import {
  SemanticResultError,
  deriveAppendPreflightRequest,
  validateSemanticResult,
} from "./core.mjs";
import { BridgeAdapterError, MAX_WAIT_TIMEOUT_MS } from "./bridge-port.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ACTIVE_OPERATION_SET = new Set(ACTIVE_PROTOCOL_OPERATIONS);
const MAX_MCP_ENVELOPE_BYTES = 10 * 1024 * 1024;

const ERROR_MESSAGES = Object.freeze({
  invalid_input: "The Zotero tool input or retained comparison evidence is invalid.",
  connection_unavailable: "The dedicated Zotero bridge is unavailable or does not advertise this operation.",
  connection_changed: "The dedicated Zotero bridge connection changed during this request.",
  access_denied: "The dedicated Zotero bridge path failed its safety checks.",
  identity_conflict: "This operation ID already identifies different request content.",
  wait_expired: "No complete Zotero result arrived before the bounded wait expired; native outcome may still be unknown.",
  invalid_result: "The Zotero result did not match its recorded request and was withheld.",
  result_too_large: "The Zotero result exceeds the dedicated MCP server result limit.",
  io_error: "The dedicated Zotero bridge could not confirm this operation safely.",
});

class PreflightError extends Error {
  constructor(code = "invalid_input") {
    super("Mutation preflight did not establish complete comparison evidence");
    this.name = "PreflightError";
    this.code = code;
  }
}

function cloneSnapshot(value) {
  try {
    return structuredClone(value);
  } catch {
    throw new PreflightError("invalid_input");
  }
}

function publicationForDelivery(delivery) {
  if (delivery === "published") return "observed_published";
  if (delivery === "not_published") return "observed_not_published";
  return "unknown";
}

function mergePublication(current, observed) {
  if (current === "published" || observed === "published") return "published";
  if (current === "unknown" || observed === "unknown") return "unknown";
  return "not_published";
}

function deliveryForPublication(publication) {
  if (publication === "published") return "published";
  if (publication === "not_published") return "not_published";
  return "unconfirmed";
}

function wrapperError(connection, publication, code) {
  const supportedCode = Object.hasOwn(ERROR_MESSAGES, code) ? code : "io_error";
  return {
    connection: connection === undefined ? null : connection,
    delivery: deliveryForPublication(publication),
    result: null,
    error: {
      code: supportedCode,
      message: ERROR_MESSAGES[supportedCode],
    },
  };
}

function wrapperSuccess(connection, result) {
  return {
    connection,
    delivery: "published",
    result,
    error: null,
  };
}

function ensureEnvelopeBudget(wrapper) {
  if (encoder.encode(JSON.stringify(wrapper)).byteLength >= MAX_MCP_ENVELOPE_BYTES) {
    throw new BridgeAdapterError(
      "result_too_large",
      ERROR_MESSAGES.result_too_large,
      "published",
    );
  }
  return wrapper;
}

function representableAnnotationBody(body) {
  return typeof body === "string" && body.trim().normalize() === body;
}

function assertBodyLimit(body, maxTextBytes = MAX_TEXT_BYTES) {
  if (encoder.encode(body).byteLength > maxTextBytes) throw new PreflightError("invalid_input");
}

function validateNativeResponseEnvelope(request, response) {
  const validated = validateProtocolResponse(request.operation, response);
  if (validated.operationId !== request.operationId) {
    throw new SemanticResultError("Native result operation identity does not match");
  }
  return validated;
}

function validateNativeResponse(request, response, evidence) {
  return validateSemanticResult(
    request,
    validateNativeResponseEnvelope(request, response),
    evidence,
  );
}

function activeCapabilities(status, session) {
  if (
    status.protocolVersion !== 1 ||
    status.profile.id !== session.connection.profileId ||
    status.enabled !== true ||
    status.capabilities.operations.some((operation) => !ACTIVE_OPERATION_SET.has(operation))
  ) {
    throw new SemanticResultError("Connection capability result does not match the active bridge");
  }
  return Object.freeze({
    profileId: session.connection.profileId,
    sessionId: session.connection.sessionId,
    companionVersion: status.pluginVersion,
    descriptorIdentity: session.descriptorIdentity,
    descriptorSignature: decoder.decode(session.descriptorBytes),
    operations: Object.freeze([...status.capabilities.operations]),
    maxRequestBytes: Math.min(session.maxRequestBytes, status.capabilities.maxRequestBytes),
    maxTextBytes: Math.min(MAX_TEXT_BYTES, status.capabilities.maxTextBytes),
  });
}

function capabilityKey(connection) {
  return `${connection.profileId}\u0000${connection.sessionId}`;
}

function responseContext(toolName, input, publication, recordedRequest = undefined) {
  return {
    toolName,
    input,
    publication: publicationForDelivery(publication),
    ...(recordedRequest === undefined ? {} : { recordedRequest }),
  };
}

export class ZoteroMcpService {
  #adapter;
  #waitTimeoutMs;
  #capabilities = new Map();
  #notePolicy;
  #createStatusOperationId;
  #close;

  constructor(options) {
    if (
      options === null ||
      typeof options !== "object" ||
      options.adapter === null ||
      typeof options.adapter !== "object" ||
      options.notePolicy === null ||
      typeof options.notePolicy !== "object" ||
      typeof options.createStatusOperationId !== "function"
    ) {
      throw new TypeError("ZoteroMcpService requires bridge and note-policy ports");
    }
    this.#waitTimeoutMs = options.waitTimeoutMs ?? 60_000;
    if (
      !Number.isSafeInteger(this.#waitTimeoutMs) ||
      this.#waitTimeoutMs < 1 ||
      this.#waitTimeoutMs > MAX_WAIT_TIMEOUT_MS
    ) {
      throw new TypeError(`waitTimeoutMs must be an integer from 1 to ${MAX_WAIT_TIMEOUT_MS}`);
    }
    this.#adapter = options.adapter;
    this.#notePolicy = options.notePolicy;
    this.#createStatusOperationId = options.createStatusOperationId;
    this.#close = options.close;
  }

  async close() {
    await this.#close?.();
  }

  async callTool(toolName, inputValue) {
    const deadline = performance.now() + this.#waitTimeoutMs;
    let input;
    let prepared;
    try {
      input = cloneSnapshot(inputValue);
      prepared = prepareZoteroMcpToolCall(toolName, input);
    } catch {
      return wrapperError(undefined, "not_published", "invalid_input");
    }

    if (prepared.kind === "lookup") {
      return this.#lookup(toolName, input, prepared, deadline);
    }
    return this.#invoke(toolName, input, prepared, deadline);
  }

  async #invoke(toolName, input, prepared, deadline) {
    let session;
    let publication = "not_published";
    try {
      session = await this.#adapter.openCurrent(prepared.connection ?? undefined, { deadline });
      this.#remainingTimeout(deadline, publication);
      let evidence;

      if (prepared.operation === "connection_status") {
        const response = await this.#execute(
          session,
          prepared.request,
          deadline,
          () => { publication = "published"; },
        );
        validateSemanticResult(
          prepared.request,
          response,
          { connection: session.connection },
        );
        if (response.state === "succeeded") this.#cacheCapabilities(session, response.data);
        const wrapper = ensureEnvelopeBudget(wrapperSuccess(session.connection, response));
        validateZoteroMcpResult(
          responseContext(toolName, input, "published"),
          wrapper,
        );
        this.#remainingTimeout(deadline, "published");
        return wrapper;
      }

      const capabilities = await this.#capabilitiesFor(session, deadline);
      this.#remainingTimeout(deadline, publication);
      if (!capabilities.operations.includes(prepared.operation)) {
        return wrapperError(session.connection, "not_published", "connection_unavailable");
      }
      if (canonicalRequestBytes(prepared.request).byteLength > capabilities.maxRequestBytes) {
        return wrapperError(session.connection, "not_published", "invalid_input");
      }

      const prior = await this.#adapter.inspectRequest(session, prepared.request, { deadline });
      if (prior.state === "matching") publication = "published";
      this.#remainingTimeout(deadline, publication);
      if (prior.state === "conflict") {
        return wrapperError(session.connection, "not_published", "identity_conflict");
      }

      if (this.#isWrite(prepared.operation) && prior.state === "absent") {
        evidence = await this.#newWriteEvidence(
          session,
          prepared.request,
          capabilities,
          deadline,
        );
      }

      const response = await this.#execute(
        session,
        prepared.request,
        deadline,
        () => { publication = "published"; },
      );
      if (
        this.#isWrite(prepared.operation) &&
        response.state === "succeeded" &&
        evidence === undefined
      ) {
        evidence = await this.#retainedWriteEvidence(session, prepared.request, deadline);
        this.#remainingTimeout(deadline, "published");
      }
      validateSemanticResult(prepared.request, response, evidence);
      const wrapper = ensureEnvelopeBudget(wrapperSuccess(session.connection, response));
      validateZoteroMcpResult(
        responseContext(toolName, input, publication),
        wrapper,
      );
      this.#remainingTimeout(deadline, publication);
      return wrapper;
    } catch (error) {
      if (error instanceof BridgeAdapterError) {
        return wrapperError(
          session?.connection,
          mergePublication(publication, error.publication),
          error.code,
        );
      }
      if (error instanceof PreflightError) {
        return wrapperError(session?.connection, publication, error.code);
      }
      if (error instanceof SemanticResultError || error?.name === "ProtocolValidationError") {
        return wrapperError(session?.connection, publication === "published" ? "published" : "not_published", "invalid_result");
      }
      return wrapperError(session?.connection, publication, "io_error");
    }
  }

  async #lookup(toolName, input, prepared, deadline) {
    let session;
    let request;
    try {
      session = await this.#adapter.openHistorical(prepared.connection, { deadline });
      this.#remainingTimeout(deadline, "unknown");
      request = await this.#adapter.readRecordedRequest(
        session,
        prepared.operationId,
        { deadline },
      );
      this.#remainingTimeout(deadline, request === undefined ? "unknown" : "published");
      if (request === undefined) {
        return wrapperError(session.connection, "unknown", "invalid_result");
      }
      if (!ACTIVE_OPERATION_SET.has(request.operation)) {
        return wrapperError(session.connection, "unknown", "invalid_result");
      }
      if (
        request.profileId !== undefined &&
        request.profileId !== session.connection.profileId
      ) {
        return wrapperError(session.connection, "unknown", "invalid_result");
      }
      const result = await this.#adapter.readRecordedResult(
        session,
        prepared.operationId,
        { deadline, publication: "published" },
      );
      this.#remainingTimeout(deadline, "published");
      if (result === undefined) {
        const wrapper = wrapperError(session.connection, "published", "wait_expired");
        validateZoteroMcpResult(
          responseContext(toolName, input, "published", request),
          wrapper,
        );
        return wrapper;
      }
      const response = validateNativeResponseEnvelope(request, result);
      const evidence = this.#isWrite(request.operation) && response.state === "succeeded"
        ? await this.#retainedWriteEvidence(session, request, deadline)
        : undefined;
      this.#remainingTimeout(deadline, "published");
      validateSemanticResult(
        request,
        response,
        request.operation === "connection_status"
          ? { connection: session.connection }
          : evidence,
      );
      const wrapper = ensureEnvelopeBudget(wrapperSuccess(session.connection, response));
      validateZoteroMcpResult(
        responseContext(toolName, input, "published", request),
        wrapper,
      );
      this.#remainingTimeout(deadline, "published");
      return wrapper;
    } catch (error) {
      if (error instanceof BridgeAdapterError && error.code === "wait_expired") {
        return wrapperError(
          session?.connection ?? prepared.connection,
          request === undefined
            ? error.publication
            : mergePublication("published", error.publication),
          "wait_expired",
        );
      }
      if (
        error instanceof BridgeAdapterError &&
        (error.code === "connection_changed" ||
          error.code === "connection_unavailable" ||
          error.code === "access_denied")
      ) {
        return wrapperError(
          session?.connection ?? prepared.connection,
          "unknown",
          error.code,
        );
      }
      if (request === undefined) {
        return wrapperError(session?.connection ?? prepared.connection, "unknown", "invalid_result");
      }
      if (error instanceof BridgeAdapterError && error.code === "result_too_large") {
        return wrapperError(session?.connection, "published", "result_too_large");
      }
      return wrapperError(session?.connection, "published", "invalid_result");
    }
  }

  async #capabilitiesFor(session, deadline) {
    const key = capabilityKey(session.connection);
    const cached = this.#capabilities.get(key);
    const descriptorSignature = decoder.decode(session.descriptorBytes);
    if (cached !== undefined) {
      if (
        cached.descriptorIdentity !== session.descriptorIdentity ||
        cached.descriptorSignature !== descriptorSignature
      ) {
        throw new PreflightError("connection_changed");
      }
      return cached;
    }
    const request = validateProtocolRequest({
      protocolVersion: 1,
      operationId: this.#createStatusOperationId(),
      operation: "connection_status",
      profileId: session.connection.profileId,
      payload: {},
    });
    let response;
    try {
      response = await this.#execute(
        session,
        request,
        deadline,
      );
    } catch (error) {
      throw this.#internalPreflightError(error, "connection_unavailable");
    }
    validateSemanticResult(request, response, { connection: session.connection });
    if (response.state !== "succeeded") throw new PreflightError("connection_unavailable");
    return this.#cacheCapabilities(session, response.data);
  }

  #cacheCapabilities(session, status) {
    const next = activeCapabilities(status, session);
    const key = capabilityKey(session.connection);
    const prior = this.#capabilities.get(key);
    if (prior !== undefined) {
      if (
        prior.descriptorIdentity !== next.descriptorIdentity ||
        prior.descriptorSignature !== next.descriptorSignature
      ) {
        throw new SemanticResultError("Descriptor changed within one bridge session");
      }
      if (prior.companionVersion !== next.companionVersion) {
        throw new SemanticResultError("Companion version changed within one bridge session");
      }
    }
    this.#capabilities.set(key, next);
    return next;
  }

  async #execute(session, request, deadline, onPublished = undefined) {
    this.#remainingTimeout(deadline, "not_published");
    try {
      const publication = await this.#adapter.publishRequest(session, request, { deadline });
      if (publication !== "published") {
        throw new BridgeAdapterError(
          "io_error",
          "Request publication could not be confirmed.",
          "unknown",
        );
      }
    } catch (error) {
      if (error instanceof BridgeAdapterError) throw error;
      throw new BridgeAdapterError(
        "io_error",
        "Request publication could not be confirmed.",
        "unknown",
        { cause: error },
      );
    }
    onPublished?.();
    const timeoutMs = this.#remainingTimeout(deadline, "published");
    const result = await this.#adapter.waitForResult(session, request, {
      deadline,
      timeoutMs,
    });
    this.#remainingTimeout(deadline, "published");
    const response = validateNativeResponseEnvelope(request, result);
    this.#remainingTimeout(deadline, "published");
    return response;
  }

  async #newWriteEvidence(session, request, capabilities, deadline) {
    if (request.operation === "create_annotation" || request.operation === "update_annotation") {
      if (request.payload.mode !== "append") {
        const body = request.payload.comment;
        if (!representableAnnotationBody(body)) throw new PreflightError();
        assertBodyLimit(body, capabilities.maxTextBytes);
        return { expectedBody: body };
      }
    }
    if (request.operation === "create_note") {
      const expectedBody = safeNativeNoteContent(request.payload.content, this.#notePolicy);
      assertBodyLimit(expectedBody, capabilities.maxTextBytes);
      return { expectedBody };
    }
    if (request.operation === "update_note" && request.payload.mode === "replace") {
      const expectedBody = safeNativeNoteContent(request.payload.content, this.#notePolicy);
      assertBodyLimit(expectedBody, capabilities.maxTextBytes);
      return { expectedBody };
    }
    const preflight = await deriveAppendPreflightRequest(request);
    if (!capabilities.operations.includes(preflight.operation)) {
      throw new PreflightError("connection_unavailable");
    }
    if (canonicalRequestBytes(preflight).byteLength > capabilities.maxRequestBytes) {
      throw new PreflightError("invalid_input");
    }
    let response;
    try {
      response = await this.#execute(session, preflight, deadline);
    } catch (error) {
      throw this.#internalPreflightError(error);
    }
    validateSemanticResult(preflight, response);
    if (response.state !== "succeeded") throw new PreflightError();
    return this.#appendEvidence(request, preflight, response, capabilities.maxTextBytes);
  }

  async #retainedWriteEvidence(session, request, deadline) {
    if (
      (request.operation !== "update_annotation" && request.operation !== "update_note") ||
      request.payload.mode !== "append"
    ) {
      try {
        return this.#newWriteEvidenceWithoutRead(request);
      } catch {
        throw new SemanticResultError("Retained complete-body evidence is invalid");
      }
    }
    const preflight = await deriveAppendPreflightRequest(request);
    const recordedRequest = await this.#adapter.readRecordedRequest(
      session,
      preflight.operationId,
      { deadline, publication: "published" },
    );
    this.#remainingTimeout(deadline, "published");
    if (recordedRequest === undefined) throw new SemanticResultError("Append comparison request is missing");
    if (
      !this.#sameBytes(
        canonicalRequestBytes(recordedRequest),
        canonicalRequestBytes(preflight),
      )
    ) {
      throw new SemanticResultError("Append comparison request does not match");
    }
    const recordedResult = await this.#adapter.readRecordedResult(
      session,
      preflight.operationId,
      { deadline, publication: "published" },
    );
    this.#remainingTimeout(deadline, "published");
    if (recordedResult === undefined) throw new SemanticResultError("Append comparison result is missing");
    const response = validateNativeResponse(preflight, recordedResult, undefined);
    if (response.state !== "succeeded") throw new SemanticResultError("Append comparison did not succeed");
    try {
      return this.#appendEvidence(request, preflight, response);
    } catch (error) {
      if (error instanceof SemanticResultError) throw error;
      throw new SemanticResultError("Append comparison evidence is invalid");
    }
  }

  #newWriteEvidenceWithoutRead(request) {
    if (request.operation === "create_annotation" || request.operation === "update_annotation") {
      const expectedBody = request.payload.comment;
      if (!representableAnnotationBody(expectedBody)) throw new PreflightError();
      assertBodyLimit(expectedBody);
      return { expectedBody };
    }
    const expectedBody = safeNativeNoteContent(request.payload.content, this.#notePolicy);
    assertBodyLimit(expectedBody);
    return { expectedBody };
  }

  #appendEvidence(request, preflight, response, maxTextBytes = MAX_TEXT_BYTES) {
    if (request.operation === "update_annotation") {
      const matches = response.data.annotations.filter(
        (annotation) => annotation.annotationKey === request.payload.annotationKey,
      );
      if (matches.length !== 1 || matches[0].revision !== request.payload.expectedRevision) {
        throw new PreflightError();
      }
      const expectedBody = `${matches[0].comment}\n\n${request.payload.comment}`;
      if (
        !representableAnnotationBody(request.payload.comment) ||
        !representableAnnotationBody(expectedBody)
      ) {
        throw new PreflightError();
      }
      assertBodyLimit(expectedBody, maxTextBytes);
      return {
        expectedBody,
        preflightOperationId: preflight.operationId,
        priorRevision: matches[0].revision,
      };
    }

    const prior = response.data;
    if (prior.revision !== request.payload.expectedRevision) throw new PreflightError();
    if (!isSafeNativeNoteContent(prior.content, this.#notePolicy)) throw new PreflightError();
    const expectedBody = appendNoteContent(prior.content, request.payload.content, this.#notePolicy);
    assertBodyLimit(expectedBody, maxTextBytes);
    return {
      expectedBody,
      preflightOperationId: preflight.operationId,
      priorRevision: prior.revision,
    };
  }

  #isWrite(operation) {
    return (
      operation === "create_annotation" ||
      operation === "update_annotation" ||
      operation === "create_note" ||
      operation === "update_note"
    );
  }

  #remainingTimeout(deadline, publication) {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1) {
      throw new BridgeAdapterError(
        "wait_expired",
        ERROR_MESSAGES.wait_expired,
        publication,
      );
    }
    return Math.min(remaining, MAX_WAIT_TIMEOUT_MS);
  }

  #internalPreflightError(error, fallback = "invalid_input") {
    if (error instanceof PreflightError) return error;
    if (error instanceof BridgeAdapterError && Object.hasOwn(ERROR_MESSAGES, error.code)) {
      return new PreflightError(error.code);
    }
    if (error instanceof SemanticResultError || error?.name === "ProtocolValidationError") {
      return new PreflightError("invalid_result");
    }
    return new PreflightError(fallback);
  }

  #sameBytes(left, right) {
    if (left.byteLength !== right.byteLength) return false;
    return left.every((byte, index) => byte === right[index]);
  }
}

export function createZoteroMcpService(options) {
  return new ZoteroMcpService(options);
}
