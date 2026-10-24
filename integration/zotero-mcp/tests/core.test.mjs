import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAppendPreflightRequest,
  validateSemanticResult,
} from "../src/core.mjs";

function response(operationId, data) {
  return {
    protocolVersion: 1,
    operationId,
    state: "succeeded",
    data,
    error: null,
    verification: { storage: "not_applicable", viewer: "not_applicable" },
  };
}

test("semantic joins reject wrong note, annotation, parent, and resolved-anchor identities", () => {
  const cases = [
    {
      request: {
        protocolVersion: 1,
        operationId: "read-note",
        operation: "read_note",
        profileId: "profile-A",
        payload: { libraryId: "1", itemKey: "ITEM1", noteKey: "NOTE1" },
      },
      data: {
        parentItemKey: "OTHER",
        noteKey: "NOTE2",
        revision: "rev:1",
        content: "body",
        deepLink: "zotero://select/library/items/NOTE2",
      },
    },
    {
      request: {
        protocolVersion: 1,
        operationId: "update-annotation",
        operation: "update_annotation",
        profileId: "profile-A",
        authorization: { kind: "explicit_request", scope: "Replace ANN1." },
        payload: {
          libraryId: "1",
          attachmentKey: "ATTACH1",
          annotationKey: "ANN1",
          expectedRevision: "rev:1",
          mode: "replace",
          comment: "new body",
        },
      },
      data: {
        annotationKey: "ANN2",
        revision: "rev:2",
        comment: "new body",
        deepLink: "zotero://open-pdf/library/items/ATTACH1?annotation=ANN2",
      },
      evidence: { expectedBody: "new body" },
    },
    {
      request: {
        protocolVersion: 1,
        operationId: "resolve-anchor",
        operation: "resolve_anchor",
        profileId: "profile-A",
        payload: {
          libraryId: "1",
          attachmentKey: "ATTACH1",
          fingerprint: "sha256:one",
          pageIndex: 2,
          quote: { exact: "passage" },
        },
      },
      data: {
        status: "resolved",
        anchor: {
          libraryId: "1",
          itemKey: "ITEM1",
          attachmentKey: "OTHER",
          attachmentFingerprint: "sha256:one",
          pageIndex: 2,
          pageLabel: "3",
          rectangles: [{ x1: 1, y1: 1, x2: 2, y2: 2 }],
          selectedText: "passage",
          matchEvidence: { method: "exact_quote", matchedText: "passage", exact: true },
        },
      },
    },
  ];

  for (const entry of cases) {
    assert.throws(
      () => validateSemanticResult(entry.request, response(entry.request.operationId, entry.data), entry.evidence),
      /does not match/u,
    );
  }
});

test("append preflight IDs are deterministic and retain the requested target and revision", async () => {
  const request = {
    protocolVersion: 1,
    operationId: "update-note-unicode",
    operation: "update_note",
    profileId: "profile-A",
    authorization: { kind: "explicit_request", scope: "한국어 질문을 NOTE1에 추가합니다." },
    payload: {
      libraryId: "1",
      itemKey: "ITEM1",
      noteKey: "NOTE1",
      expectedRevision: "rev:9",
      mode: "append",
      content: "질문: 왜 이 단계가 필요한가? 🧪",
    },
  };
  const first = await deriveAppendPreflightRequest(request);
  const second = await deriveAppendPreflightRequest(structuredClone(request));
  assert.deepEqual(first, second);
  assert.match(first.operationId, /^mcp\.preflight\.[0-9a-f]{64}$/u);
  assert.equal(first.operation, "read_note");
  assert.deepEqual(first.payload, {
    libraryId: "1",
    itemKey: "ITEM1",
    noteKey: "NOTE1",
  });
  assert.equal("authorization" in first, false);
});

test("complete Unicode write bodies must equal the prepared body", () => {
  const request = {
    protocolVersion: 1,
    operationId: "create-note-unicode",
    operation: "create_note",
    profileId: "profile-A",
    authorization: { kind: "explicit_request", scope: "Create the requested note." },
    payload: { libraryId: "1", itemKey: "ITEM1", content: "한글 e\u0301 🧪" },
  };
  const result = response(request.operationId, {
    noteKey: "NOTE1",
    revision: "rev:1",
    content: "한글 é 🧪",
    deepLink: "zotero://select/library/items/NOTE1",
  });
  assert.throws(
    () => validateSemanticResult(request, result, { expectedBody: "한글 e\u0301 🧪" }),
    /complete saved body/u,
  );
});

test("range and candidate results must completely join to the recorded read request", () => {
  const readRequest = {
    protocolVersion: 1,
    operationId: "read-pages",
    operation: "read_pdf",
    profileId: "profile-A",
    payload: {
      libraryId: "1",
      itemKey: "ITEM1",
      attachmentKey: "ATTACH1",
      pageRange: { startPageIndex: 2, endPageIndex: 3 },
    },
  };
  assert.throws(
    () => validateSemanticResult(readRequest, response(readRequest.operationId, {
      attachmentFingerprint: "sha256:one",
      attachmentRevision: "rev:1",
      pages: [{
        pageIndex: 2,
        pageLabel: "3",
        text: "only one page",
        passageCandidates: [],
        regionCandidates: [],
      }],
    })),
    /page evidence/u,
  );

  const resolveRequest = {
    protocolVersion: 1,
    operationId: "resolve-candidate",
    operation: "resolve_anchor",
    profileId: "profile-A",
    payload: {
      libraryId: "1",
      attachmentKey: "ATTACH1",
      fingerprint: "sha256:one",
      pageIndex: 2,
      quote: { exact: "passage" },
    },
  };
  assert.throws(
    () => validateSemanticResult(resolveRequest, response(resolveRequest.operationId, {
      status: "unresolved",
      reason: "ambiguous",
      candidates: [{
        reason: "candidate",
        anchor: {
          libraryId: "1",
          itemKey: "ITEM1",
          attachmentKey: "OTHER",
          attachmentFingerprint: "sha256:one",
          pageIndex: 2,
          pageLabel: "3",
          rectangles: [{ x1: 1, y1: 1, x2: 2, y2: 2 }],
          selectedText: "passage",
          matchEvidence: { method: "exact_quote", matchedText: "passage", exact: true },
        },
      }],
    })),
    /anchor identity/u,
  );
});
