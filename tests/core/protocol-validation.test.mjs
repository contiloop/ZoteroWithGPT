import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_REQUEST_BYTES,
  MUTATION_OPERATION_NAMES,
  NATIVE_ANNOTATION_COLORS,
  OPERATION_NAMES,
  ProtocolValidationError,
  parseProtocolRequest,
  parseArxivUrl,
  validateProtocolRequest,
  validateProtocolResponse,
} from "../../dist/protocol/index.js";
import { decideArxivImport } from "../../dist/core/arxiv-selection.js";

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

const arxivSource = {
  arxivId: "2401.01234",
  version: 2,
  abstractUrl: "https://arxiv.org/abs/2401.01234v2",
  pdfUrl: "https://arxiv.org/pdf/2401.01234v2",
  metadata: {
    title: "A Strict Import Contract",
    authors: ["Ada Researcher", "Grace Scholar"],
    published: "2024-01-02T03:04:05Z",
    updated: "2024-02-03T04:05:06Z",
    abstract: "",
    doi: "10.1000/example",
  },
};

const inspectData = {
  source: arxivSource,
  libraryId: "1",
  candidates: [
    {
      itemKey: "ITEM1234",
      itemRevision: "rev:4",
      title: "A Strict Import Contract",
      attachments: [
        {
          attachmentKey: "ATTACH01",
          fingerprint: "sha256:known-pdf",
          version: 2,
          identity: "verified",
        },
      ],
    },
  ],
  decision: "reuse",
  reason: "The current attachment has verified matching provenance.",
  inspectionToken: "inspection:2401.01234:v2:snapshot-1",
  selection: {
    kind: "reuse",
    itemKey: "ITEM1234",
    attachmentKey: "ATTACH01",
    expectedFingerprint: "sha256:known-pdf",
  },
};

function responseEnvelope(operationId, state, data, error, verification) {
  return { protocolVersion: 1, operationId, state, data, error, verification };
}

test("protocol v1 adds exactly the two arXiv operations and classifies only ensure as a mutation", () => {
  assert.equal(OPERATION_NAMES.length, 14);
  assert.deepEqual(OPERATION_NAMES.slice(-2), ["inspect_arxiv", "ensure_arxiv_pdf"]);
  assert.equal(new Set(OPERATION_NAMES).size, 14);
  assert.equal(MUTATION_OPERATION_NAMES.length, 5);
  assert.equal(MUTATION_OPERATION_NAMES.includes("inspect_arxiv"), false);
  assert.equal(MUTATION_OPERATION_NAMES.includes("ensure_arxiv_pdf"), true);
});

test("inspect_arxiv accepts bounded official arXiv URLs without read authorization", () => {
  const modern = validateProtocolRequest({
    protocolVersion: 1,
    operationId: "op.inspect-modern-1",
    operation: "inspect_arxiv",
    profileId: "profile-A",
    payload: { url: "https://arxiv.org/abs/2401.01234v2" },
  });
  assert.deepEqual(parseArxivUrl(modern.payload.url), {
    arxivId: "2401.01234",
    version: 2,
  });

  assert.deepEqual(parseArxivUrl("https://arxiv.org/pdf/hep-th/9901001v3.pdf"), {
    arxivId: "hep-th/9901001",
    version: 3,
  });
  assert.deepEqual(parseArxivUrl("http://www.arxiv.org/abs/2401.01234.pdf?download=1#page=2"), {
    arxivId: "2401.01234",
  });
  assert.deepEqual(parseArxivUrl("https://arxiv.org/abs/math/0211159v4.pdf?context=study"), {
    arxivId: "math/0211159",
    version: 4,
  });
  assert.deepEqual(parseArxivUrl("http://arxiv.org:80/pdf/2401.01234.pdf"), {
    arxivId: "2401.01234",
  });

  expectCode(
    () => validateProtocolRequest({ ...modern, authorization: {
      kind: "explicit_request", scope: "Inspect this article.",
    } }),
    "invalid_request",
  );
});

test("inspect_arxiv rejects malformed, non-arXiv, and oversized URLs", () => {
  const base = {
    protocolVersion: 1,
    operationId: "op.inspect-invalid-1",
    operation: "inspect_arxiv",
    profileId: "profile-A",
  };
  for (const url of [
    "https://example.com/abs/2401.01234",
    "https://arxiv.org.evil.example/abs/2401.01234",
    "https://user:secret@arxiv.org/abs/2401.01234",
    "https://arxiv.org:8443/abs/2401.01234",
    "https://127.0.0.1/abs/2401.01234",
    "https://arxiv.org/html/2401.01234",
    " https://arxiv.org/abs/2401.01234",
    "https://arxiv.org/abs/../pdf/2401.01234",
    "https://arxiv.org/abs/%2e%2e/pdf/2401.01234",
    "https://arxiv.org/abs/.\n./pdf/2401.01234v2",
    "https://arxiv.org/abs/%2e%2e\t/pdf/2401.01234v2",
    "https://arxiv.org\\evil.example/abs/2401.01234",
    "https://arxiv.org/abs/2413.01234",
    "https://arxiv.org/abs/2401.00000",
    "https://arxiv.org/abs/2401.01234v0",
    "https://arxiv.org/abs/hep-th/9913001",
    "https://arxiv.org/abs/hep-th/9901000",
  ]) {
    expectCode(() => validateProtocolRequest({ ...base, payload: { url } }), "invalid_request");
  }
  expectCode(
    () => validateProtocolRequest({ ...base, payload: { url: "가".repeat(1_366) } }),
    "too_large",
  );

  const requestSchema = JSON.parse(readFileSync(new URL(
    "../../scripts/package/assets/protocol/v1-request.schema.json",
    import.meta.url,
  ), "utf8"));
  const schemaPattern = new RegExp(
    requestSchema.$defs.inspectArxivPayload.properties.url.pattern,
    "u",
  );
  assert.equal(schemaPattern.test("https://arxiv.org/abs/.\n./pdf/2401.01234v2"), false);
  assert.equal(schemaPattern.test("https://arxiv.org/abs/../pdf/2401.01234v2"), false);
  assert.equal(schemaPattern.test("https://arxiv.org/abs/%2e%2e/pdf/2401.01234v2"), false);
  assert.equal(schemaPattern.test("https://arxiv.org\\evil/abs/2401.01234v2"), false);
  assert.equal(schemaPattern.test("https://arxiv.org/abs/2401.01234v2?download=1#page=2"), true);
});

test("ensure_arxiv_pdf requires scoped mutation authorization and strict identity and selection", () => {
  const base = {
    protocolVersion: 1,
    operationId: "op.ensure-1",
    operation: "ensure_arxiv_pdf",
    profileId: "profile-A",
    payload: {
      source: { arxivId: "2401.01234", version: 2 },
      inspectionToken: "inspection:2401.01234:v2:snapshot-1",
      selection: {
        kind: "attach",
        itemKey: "ITEM1234",
        expectedItemRevision: "rev:4",
      },
    },
  };
  expectCode(() => validateProtocolRequest(base), "permission_denied");

  const authorized = {
    ...base,
    authorization: {
      kind: "explicit_request",
      scope: "Attach arXiv 2401.01234v2 to ITEM1234 after the inspected snapshot.",
    },
  };
  assert.equal(validateProtocolRequest(authorized).payload.selection.kind, "attach");

  for (const payload of [
    { ...base.payload, source: { arxivId: "2401.01234v2", version: 2 } },
    { ...base.payload, source: { arxivId: "2401.01234", version: 0 } },
    { ...base.payload, source: { arxivId: "legacy/9913001", version: 1 } },
    { ...base.payload, selection: { kind: "create", itemKey: "unexpected" } },
    { ...base.payload, selection: { kind: "reuse", itemKey: "ITEM1234" } },
    { ...base.payload, selection: null },
  ]) {
    expectCode(() => validateProtocolRequest({ ...authorized, payload }), "invalid_request");
  }
});

test("inspect_arxiv response validation enforces the complete strict result shape", () => {
  const valid = responseEnvelope(
    "op.inspect-result-1",
    "succeeded",
    inspectData,
    null,
    { storage: "not_applicable", viewer: "not_applicable" },
  );
  assert.deepEqual(validateProtocolResponse("inspect_arxiv", valid), valid);

  const invalidData = [
    { ...inspectData, unexpected: true },
    { ...inspectData, reason: "" },
    { ...inspectData, decision: "needs_choice", selection: { kind: "create" } },
    { ...inspectData, source: { ...arxivSource, abstractUrl: "https://evil.example/a" } },
    { ...inspectData, source: { ...arxivSource, metadata: { ...arxivSource.metadata, authors: [""] } } },
    { ...inspectData, source: { ...arxivSource, metadata: { ...arxivSource.metadata, abstract: null } } },
    {
      ...inspectData,
      source: {
        ...arxivSource,
        metadata: {
          ...arxivSource.metadata,
          published: "2024-02-30T03:04:05Z",
          updated: "2024-03-05T04:05:06Z",
        },
      },
    },
    {
      ...inspectData,
      source: {
        ...arxivSource,
        metadata: {
          ...arxivSource.metadata,
          published: "2023-02-29T03:04:05Z",
          updated: "2023-03-05T04:05:06Z",
        },
      },
    },
  ];
  for (const data of invalidData) {
    expectCode(
      () => validateProtocolResponse("inspect_arxiv", { ...valid, data }),
      "invalid_request",
    );
  }

  const leapDay = {
    ...valid,
    data: {
      ...inspectData,
      source: {
        ...arxivSource,
        metadata: {
          ...arxivSource.metadata,
          published: "2024-02-29T03:04:05Z",
          updated: "2024-03-01T04:05:06Z",
        },
      },
    },
  };
  assert.deepEqual(validateProtocolResponse("inspect_arxiv", leapDay), leapDay);

  const timestampOffset = {
    ...valid,
    data: {
      ...inspectData,
      source: {
        ...arxivSource,
        metadata: {
          ...arxivSource.metadata,
          published: "2024-02-29T12:34:56+09:00",
          updated: "2024-02-29T13:34:56+09:00",
        },
      },
    },
  };
  assert.deepEqual(validateProtocolResponse("inspect_arxiv", timestampOffset), timestampOffset);
});

test("a fingerprint conflict remains a schema-valid conservative needs_choice decision", () => {
  const candidates = inspectData.candidates;
  const decision = decideArxivImport(
    { arxivId: arxivSource.arxivId, version: arxivSource.version },
    candidates,
    { expectedPdfFingerprint: "sha256:newly-downloaded" },
  );
  assert.equal(decision.decision, "needs_choice");
  const data = {
    source: arxivSource,
    libraryId: "1",
    candidates,
    ...decision,
    inspectionToken: "inspection:2401.01234:v2:fingerprint-conflict",
  };
  const response = responseEnvelope(
    "op.inspect-conflict-1",
    "succeeded",
    data,
    null,
    { storage: "not_applicable", viewer: "not_applicable" },
  );
  assert.deepEqual(validateProtocolResponse("inspect_arxiv", response), response);

  const schema = JSON.parse(readFileSync(new URL(
    "../../scripts/package/assets/protocol/v1-response.schema.json",
    import.meta.url,
  ), "utf8"));
  const branch = schema.$defs.inspectArxivResult.allOf.find(
    (entry) => entry.if?.properties?.decision?.const === "needs_choice",
  );
  assert.equal(branch.then.properties.candidates.minItems, 1);
  assert.equal(branch.then.properties.selection, false);
});

test("ensure_arxiv_pdf validates complete success, bounded retained failure, and indeterminate shapes", () => {
  const ready = {
    source: { arxivId: "2401.01234", version: 2 },
    libraryId: "1",
    completion: "ready",
    itemKey: "ITEM1234",
    itemAction: "reused",
    attachmentKey: "ATTACH01",
    attachmentFingerprint: "sha256:known-pdf",
    pdfAction: "reused",
    deepLink: "zotero://open-pdf/library/items/ATTACH01",
  };
  const succeeded = responseEnvelope(
    "op.ensure-result-1",
    "succeeded",
    ready,
    null,
    { storage: "confirmed", viewer: "not_checked" },
  );
  assert.deepEqual(validateProtocolResponse("ensure_arxiv_pdf", succeeded), succeeded);

  for (const data of [
    { ...ready, attachmentKey: null },
    { ...ready, attachmentFingerprint: null },
    { ...ready, pdfAction: "none" },
    { ...ready, deepLink: "" },
  ]) {
    expectCode(
      () => validateProtocolResponse("ensure_arxiv_pdf", { ...succeeded, data }),
      "invalid_request",
    );
  }

  const itemOnly = {
    ...ready,
    completion: "item_only",
    itemAction: "created",
    attachmentKey: null,
    attachmentFingerprint: null,
    pdfAction: "none",
    deepLink: "zotero://select/library/items/ITEM1234",
  };
  const failed = responseEnvelope(
    "op.ensure-result-2",
    "failed",
    itemOnly,
    { code: "storage_error", message: "The PDF acquisition failed after parent readback.", retryable: false },
    { storage: "confirmed", viewer: "not_checked" },
  );
  assert.deepEqual(validateProtocolResponse("ensure_arxiv_pdf", failed), failed);
  expectCode(
    () => validateProtocolResponse("ensure_arxiv_pdf", {
      ...failed,
      error: { ...failed.error, code: "conflict" },
    }),
    "invalid_request",
  );

  const indeterminate = responseEnvelope(
    "op.ensure-result-3",
    "indeterminate",
    null,
    { code: "unknown_outcome", message: "Commit status is unknown.", retryable: false },
    { storage: "not_checked", viewer: "not_checked" },
  );
  assert.deepEqual(validateProtocolResponse("ensure_arxiv_pdf", indeterminate), indeterminate);
  expectCode(
    () => validateProtocolResponse("ensure_arxiv_pdf", { ...indeterminate, data: itemOnly }),
    "invalid_request",
  );
});

test("distributed arXiv examples pass the same runtime validators without network access", () => {
  const example = (name) => JSON.parse(readFileSync(new URL(
    `../../scripts/package/assets/protocol/examples/${name}`,
    import.meta.url,
  ), "utf8"));

  const inspectRequest = example("inspect-arxiv.request.json");
  const inspectResponse = example("inspect-arxiv.response.json");
  const ensureRequest = example("ensure-arxiv-pdf.request.json");
  const readyResponse = example("ensure-arxiv-pdf.response.json");
  const itemOnlyResponse = example("ensure-arxiv-pdf.item-only.response.json");
  const connectionResponse = example("connection-status.response.json");
  const annotationResponse = example("create-annotation.response.json");

  assert.deepEqual(
    validateProtocolResponse("connection_status", connectionResponse),
    connectionResponse,
  );
  assert.deepEqual(
    validateProtocolResponse("create_annotation", annotationResponse),
    annotationResponse,
  );
  assert.deepEqual(validateProtocolRequest(inspectRequest), inspectRequest);
  assert.deepEqual(validateProtocolResponse("inspect_arxiv", inspectResponse), inspectResponse);
  assert.deepEqual(validateProtocolRequest(ensureRequest), ensureRequest);
  assert.deepEqual(validateProtocolResponse("ensure_arxiv_pdf", readyResponse), readyResponse);
  assert.deepEqual(
    validateProtocolResponse("ensure_arxiv_pdf", itemOnlyResponse),
    itemOnlyResponse,
  );

  expectCode(
    () => validateProtocolResponse("connection_status", {
      ...connectionResponse,
      data: { ...connectionResponse.data, unexpected: true },
    }),
    "invalid_request",
  );
});
