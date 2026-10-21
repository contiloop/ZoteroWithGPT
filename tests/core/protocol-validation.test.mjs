import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REQUEST_BYTES,
  NATIVE_ANNOTATION_COLORS,
  ProtocolValidationError,
  parseProtocolRequest,
  validateProtocolRequest,
} from "../../dist/protocol/index.js";

const connectionRequest = {
  protocolVersion: 1,
  operationId: "op.connection-1",
  operation: "connection_status",
  payload: {},
};

const resolvedAnchor = {
  libraryId: "1",
  itemKey: "ITEM1234",
  attachmentKey: "ATTACH01",
  attachmentFingerprint: "sha256:pdf-revision-a",
  pageIndex: 0,
  pageLabel: "i",
  rectangles: [{ x1: 10, y1: 20, x2: 110, y2: 34 }],
  selectedText: "A useful theorem",
  matchEvidence: {
    method: "exact_quote",
    matchedText: "A useful theorem",
    exact: true,
  },
};

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ProtocolValidationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("connection_status is the only operation that may omit profileId", () => {
  assert.deepEqual(validateProtocolRequest(connectionRequest), connectionRequest);

  expectCode(
    () =>
      validateProtocolRequest({
        ...connectionRequest,
        operationId: "op.search-1",
        operation: "search_papers",
        payload: { query: "Bayesian inference" },
      }),
    "invalid_request",
  );
});

test("unknown versions, operations, and fields are rejected", () => {
  expectCode(
    () => validateProtocolRequest({ ...connectionRequest, protocolVersion: 2 }),
    "unsupported_version",
  );
  expectCode(
    () => validateProtocolRequest({ ...connectionRequest, operation: "delete_library" }),
    "unsupported_operation",
  );
  expectCode(
    () => validateProtocolRequest({ ...connectionRequest, surprise: true }),
    "invalid_request",
  );
  expectCode(
    () =>
      validateProtocolRequest({
        ...connectionRequest,
        payload: { unexpected: true },
      }),
    "invalid_request",
  );
});

test("unsafe operation IDs are rejected before they can become filenames", () => {
  for (const operationId of ["", "../escape", "a/b", "a\\b", ".hidden", "contains space"]) {
    expectCode(
      () => validateProtocolRequest({ ...connectionRequest, operationId }),
      "invalid_request",
    );
  }
});

test("UTF-8 request size is bounded without silently truncating content", () => {
  const oversized = JSON.stringify({
    ...connectionRequest,
    operationId: "op.oversized-1",
    payload: { padding: "x".repeat(MAX_REQUEST_BYTES) },
  });
  expectCode(() => parseProtocolRequest(oversized), "too_large");
});

test("mutations require explicit, nonempty authorization scope", () => {
  const request = {
    protocolVersion: 1,
    operationId: "op.annotation-1",
    operation: "create_annotation",
    profileId: "profile-A",
    payload: {
      anchor: resolvedAnchor,
      type: "highlight",
      comment: "Proof details",
    },
  };

  expectCode(() => validateProtocolRequest(request), "permission_denied");
  expectCode(
    () =>
      validateProtocolRequest({
        ...request,
        authorization: { kind: "explicit_request", scope: "   " },
      }),
    "permission_denied",
  );

  const approved = validateProtocolRequest({
    ...request,
    authorization: {
      kind: "approved_proposal",
      scope: "Save this explanation on the selected theorem in ATTACH01.",
    },
  });
  assert.equal(approved.operation, "create_annotation");
});

test("anchors reject negative pages, malformed rectangles, and unsupported colors", () => {
  const makeRequest = (anchor, color = NATIVE_ANNOTATION_COLORS[0]) => ({
    protocolVersion: 1,
    operationId: "op.anchor-check-1",
    operation: "create_annotation",
    profileId: "profile-A",
    authorization: {
      kind: "explicit_request",
      scope: "Save the explanation on this selected passage.",
    },
    payload: { anchor, type: "highlight", comment: "Explanation", color },
  });

  expectCode(
    () => validateProtocolRequest(makeRequest({ ...resolvedAnchor, pageIndex: -1 })),
    "invalid_request",
  );
  expectCode(
    () =>
      validateProtocolRequest(
        makeRequest({
          ...resolvedAnchor,
          rectangles: [{ x1: 10, y1: 10, x2: 5, y2: 20 }],
        }),
      ),
    "invalid_request",
  );
  expectCode(
    () => validateProtocolRequest(makeRequest(resolvedAnchor, "#123456")),
    "unsupported_capability",
  );

  const accepted = validateProtocolRequest(makeRequest(resolvedAnchor));
  assert.equal(accepted.payload.color, NATIVE_ANNOTATION_COLORS[0]);
});

test("resolve_anchor requires exactly one quote or inspected-region input", () => {
  const base = {
    protocolVersion: 1,
    operationId: "op.resolve-1",
    operation: "resolve_anchor",
    profileId: "profile-A",
    payload: {
      libraryId: "1",
      attachmentKey: "ATTACH01",
      fingerprint: "sha256:pdf-revision-a",
      pageIndex: 0,
    },
  };

  expectCode(() => validateProtocolRequest(base), "invalid_request");
  expectCode(
    () =>
      validateProtocolRequest({
        ...base,
        payload: {
          ...base.payload,
          quote: { exact: "theorem" },
          inspectedRegion: {
            rectangles: [{ x1: 1, y1: 1, x2: 2, y2: 2 }],
          },
        },
      }),
    "invalid_request",
  );

  const quoteRequest = validateProtocolRequest({
    ...base,
    payload: { ...base.payload, quote: { exact: "theorem", prefix: "useful " } },
  });
  assert.equal(quoteRequest.payload.quote.exact, "theorem");
});

test("note discovery and revision-aware note operations retain their wire contract", () => {
  const list = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.notes-1",
    operation: "list_notes",
    profileId: "profile-A",
    payload: { libraryId: "1", itemKey: "ITEM1234", limit: 25 },
  });
  assert.equal(list.payload.limit, 25);

  const read = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.note-read-1",
    operation: "read_note",
    profileId: "profile-A",
    payload: { libraryId: "1", itemKey: "ITEM1234", noteKey: "NOTE1234" },
  });
  assert.equal(read.payload.noteKey, "NOTE1234");

  const update = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.note-update-1",
    operation: "update_note",
    profileId: "profile-A",
    authorization: {
      kind: "explicit_request",
      scope: "Append this question to NOTE1234.",
    },
    payload: {
      libraryId: "1",
      itemKey: "ITEM1234",
      noteKey: "NOTE1234",
      expectedRevision: "rev:9",
      mode: "append",
      content: "What changes if the prior is improper?",
    },
  });
  assert.equal(update.payload.expectedRevision, "rev:9");
});

test("long explanations remain complete annotation comments", () => {
  const comment = "Detailed proof. ".repeat(12_000);
  const request = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.long-annotation-1",
    operation: "create_annotation",
    profileId: "profile-A",
    authorization: {
      kind: "explicit_request",
      scope: "Save the full proof as the selected passage annotation.",
    },
    payload: {
      anchor: resolvedAnchor,
      type: "note",
      comment,
    },
  });

  assert.equal(request.operation, "create_annotation");
  assert.equal(request.payload.comment, comment);
});
