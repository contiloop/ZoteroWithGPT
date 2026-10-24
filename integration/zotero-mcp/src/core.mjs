import {
  canonicalRequestBytes,
  canonicalizeJson,
  parseArxivUrl,
} from "../../../dist/protocol/index.js";

const encoder = new TextEncoder();
const NATIVE_WRITE_OPERATIONS = new Set([
  "create_annotation",
  "update_annotation",
  "create_note",
  "update_note",
]);

export class SemanticResultError extends Error {
  constructor(message) {
    super(message);
    this.name = "SemanticResultError";
  }
}

function fail(message) {
  throw new SemanticResultError(message);
}

function equal(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function requireEqual(actual, expected, description) {
  if (!equal(actual, expected)) fail(`${description} does not match the recorded request`);
}

function requireText(actual, expected, description) {
  if (actual !== expected) fail(`${description} does not match the complete saved body`);
}

function succeededData(response) {
  return response.state === "succeeded" ? response.data : undefined;
}

function requireAnchorIdentity(anchor, payload) {
  if (
    anchor.libraryId !== payload.libraryId ||
    anchor.attachmentKey !== payload.attachmentKey ||
    anchor.attachmentFingerprint !== payload.fingerprint ||
    anchor.pageIndex !== payload.pageIndex
  ) {
    fail("Resolved anchor identity does not match the recorded request");
  }
}

function requireResultLimit(entries, requestedLimit, description) {
  if (requestedLimit !== undefined && entries.length > requestedLimit) {
    fail(`${description} exceeds the recorded request limit`);
  }
}

/**
 * Validates semantic request/result relationships that the shared structural
 * protocol parser cannot infer from one value in isolation.
 */
export function validateSemanticResult(request, response, evidence = undefined) {
  const data = succeededData(response);
  if (data === undefined) return response;
  if (
    NATIVE_WRITE_OPERATIONS.has(request.operation) &&
    response.verification.storage !== "confirmed"
  ) {
    fail("Successful native write storage is not confirmed");
  }

  switch (request.operation) {
    case "connection_status": {
      if (evidence?.connection !== undefined) {
        if (data.profile.id !== evidence.connection.profileId) {
          fail("Connection-status profile does not match the observed bridge session");
        }
      }
      break;
    }
    case "find_local_arxiv": {
      const source = parseArxivUrl(request.payload.url);
      requireEqual(
        data.source,
        { arxivId: source.arxivId, version: source.version ?? null },
        "Local arXiv source identity",
      );
      requireResultLimit(data.matches, request.payload.limit, "Local arXiv result");
      break;
    }
    case "search_papers":
      requireResultLimit(data.matches, request.payload.limit, "Paper search result");
      break;
    case "read_pdf": {
      const { startPageIndex, endPageIndex } = request.payload.pageRange;
      const indexes = new Set(
        Array.from(
          { length: endPageIndex - startPageIndex + 1 },
          (_, offset) => startPageIndex + offset,
        ),
      );
      for (const page of data.pages) {
        if (
          !indexes.has(page.pageIndex)
        ) {
          fail("PDF page evidence does not match the requested page range");
        }
        indexes.delete(page.pageIndex);
      }
      if (indexes.size !== 0) fail("PDF page evidence does not cover the requested page range");
      break;
    }
    case "list_annotations":
      for (const annotation of data.annotations) {
        if (
          annotation.anchor.libraryId !== request.payload.libraryId ||
          annotation.anchor.attachmentKey !== request.payload.attachmentKey
        ) {
          fail("Listed annotation ownership does not match the requested attachment");
        }
      }
      break;
    case "list_notes":
      requireResultLimit(data.notes, request.payload.limit, "Note list result");
      for (const note of data.notes) {
        if (note.parentItemKey !== request.payload.itemKey) {
          fail("Listed note parent does not match the requested item");
        }
      }
      break;
    case "read_note":
      if (
        data.parentItemKey !== request.payload.itemKey ||
        data.noteKey !== request.payload.noteKey
      ) {
        fail("Read note identity does not match the recorded request");
      }
      break;
    case "resolve_anchor":
      if (data.status === "resolved") {
        requireAnchorIdentity(data.anchor, request.payload);
      } else {
        for (const candidate of data.candidates) {
          requireAnchorIdentity(candidate.anchor, request.payload);
        }
      }
      break;
    case "create_annotation": {
      const anchor = request.payload.anchor;
      const saved = data.saved;
      requireEqual(saved.rectangles, anchor.rectangles, "Saved annotation rectangles");
      if (saved.pageIndex !== anchor.pageIndex || saved.pageLabel !== anchor.pageLabel) {
        fail("Saved annotation page does not match the recorded request");
      }
      if (
        anchor.selectedText !== undefined &&
        saved.selectedText !== anchor.selectedText
      ) {
        fail("Saved annotation selected text does not match the recorded request");
      }
      requireText(saved.comment, evidence?.expectedBody ?? request.payload.comment, "Annotation");
      break;
    }
    case "update_annotation":
      if (data.annotationKey !== request.payload.annotationKey) {
        fail("Updated annotation key does not match the recorded request");
      }
      if (typeof evidence?.expectedBody !== "string") {
        fail("Updated annotation lacks complete-body comparison evidence");
      }
      requireText(data.comment, evidence.expectedBody, "Annotation");
      break;
    case "create_note":
      if (typeof evidence?.expectedBody !== "string") {
        fail("Created note lacks complete-body comparison evidence");
      }
      requireText(data.content, evidence.expectedBody, "Note");
      break;
    case "update_note":
      if (data.noteKey !== request.payload.noteKey) {
        fail("Updated note key does not match the recorded request");
      }
      if (typeof evidence?.expectedBody !== "string") {
        fail("Updated note lacks complete-body comparison evidence");
      }
      requireText(data.content, evidence.expectedBody, "Note");
      break;
    case "verify_annotation":
      if (data.annotationKey !== request.payload.annotationKey) {
        fail("Verified annotation key does not match the recorded request");
      }
      break;
    default:
      fail("Result operation is not available through the dedicated MCP server");
  }
  return response;
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds a stable read-only request whose ordinary bridge files retain the
 * prior revision/body evidence needed to verify an append after restart.
 */
export async function deriveAppendPreflightRequest(request) {
  if (
    (request.operation !== "update_annotation" && request.operation !== "update_note") ||
    request.payload.mode !== "append"
  ) {
    return fail("Only append mutations have a retained preflight request");
  }
  const identity = encoder.encode(
    `${request.operationId}\u0000${new TextDecoder().decode(canonicalRequestBytes(request))}`,
  );
  const operationId = `mcp.preflight.${await sha256Hex(identity)}`;
  if (request.operation === "update_annotation") {
    return {
      protocolVersion: 1,
      operationId,
      operation: "list_annotations",
      profileId: request.profileId,
      payload: {
        libraryId: request.payload.libraryId,
        attachmentKey: request.payload.attachmentKey,
      },
    };
  }
  return {
    protocolVersion: 1,
    operationId,
    operation: "read_note",
    profileId: request.profileId,
    payload: {
      libraryId: request.payload.libraryId,
      itemKey: request.payload.itemKey,
      noteKey: request.payload.noteKey,
    },
  };
}

export function renderConciseToolText(wrapper) {
  if (wrapper.result !== null) {
    return `Zotero operation ${wrapper.result.operationId} is ${wrapper.result.state}.`;
  }
  return `Zotero request ended with ${wrapper.error.code}; delivery is ${wrapper.delivery}.`;
}
