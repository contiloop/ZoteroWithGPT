import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARXIV_OPERATION_NAMES,
  BASE_OPERATION_NAMES,
  MUTATION_OPERATION_NAMES,
  OPERATION_NAMES,
  ProtocolValidationError,
  parseArxivUrl,
  validateProtocolRequest,
  validateProtocolResponse,
} from "../../dist/protocol/index.js";
import { createProtocolSchemaValidators } from "../../scripts/verify/package-lib.mjs";

const PROTOCOL_ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/package/assets/protocol",
);

const request = {
  protocolVersion: 1,
  operationId: "op.find-local-arxiv-1",
  operation: "find_local_arxiv",
  profileId: "profile-A",
  payload: {
    url: "https://arxiv.org/pdf/2401.01234v2.pdf?download=1#page=3",
    limit: 25,
  },
};

const data = {
  source: { arxivId: "2401.01234", version: 2 },
  matches: [
    {
      paper: {
        libraryId: "1",
        itemKey: "ITEM0001",
        title: "A locally studied paper",
        creators: ["Ada Researcher"],
        year: 2024,
        attachments: [
          {
            attachmentKey: "ATTACH01",
            title: "Full Text PDF",
            contentType: "application/pdf",
            fingerprint: "sha256:current-pdf",
          },
          {
            attachmentKey: "ATTACH02",
            title: "Inaccessible PDF",
            contentType: "application/pdf",
          },
        ],
      },
      evidence: [
        {
          attachmentKey: null,
          origin: "url",
          arxivId: "2401.01234",
          version: 1,
        },
        {
          attachmentKey: null,
          origin: "archive_id",
          arxivId: "2401.01234",
          version: 2,
        },
        {
          attachmentKey: null,
          origin: "extra",
          arxivId: "2401.01234",
          version: 3,
        },
        {
          attachmentKey: null,
          origin: "provenance",
          arxivId: "2401.01234",
          version: 2,
        },
        {
          attachmentKey: "ATTACH01",
          origin: "url",
          arxivId: "2401.01234",
          version: 2,
        },
        {
          attachmentKey: "ATTACH01",
          origin: "provenance",
          arxivId: "2401.01234",
          version: 2,
          fingerprint: "sha256:current-pdf",
        },
      ],
    },
  ],
  truncated: false,
};

function responseWith(nextData = data) {
  return {
    protocolVersion: 1,
    operationId: request.operationId,
    state: "succeeded",
    data: nextData,
    error: null,
    verification: { storage: "not_applicable", viewer: "not_applicable" },
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ProtocolValidationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("find_local_arxiv is a parsed read without changing advertised operation groups", () => {
  assert.deepEqual(BASE_OPERATION_NAMES, [
    "connection_status",
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
  assert.deepEqual(ARXIV_OPERATION_NAMES, ["inspect_arxiv", "ensure_arxiv_pdf"]);
  assert.equal(OPERATION_NAMES.length, 15);
  assert.equal(OPERATION_NAMES.at(-1), "find_local_arxiv");
  assert.equal(new Set(OPERATION_NAMES).size, 15);
  assert.equal(MUTATION_OPERATION_NAMES.length, 5);
  assert.equal(MUTATION_OPERATION_NAMES.includes("find_local_arxiv"), false);

  assert.deepEqual(validateProtocolRequest(request), request);
  assert.deepEqual(parseArxivUrl(request.payload.url), {
    arxivId: "2401.01234",
    version: 2,
  });
  const unversioned = {
    ...request,
    operationId: "op.find-local-arxiv-2",
    payload: { url: "https://arxiv.org/abs/hep-th/9901001.pdf#local" },
  };
  assert.deepEqual(validateProtocolRequest(unversioned), unversioned);
  assert.deepEqual(parseArxivUrl(unversioned.payload.url), {
    arxivId: "hep-th/9901001",
  });
});

test("find_local_arxiv request remains a strict bounded profiled read", () => {
  expectCode(
    () => validateProtocolRequest({
      ...request,
      authorization: { kind: "explicit_request", scope: "Find this paper." },
    }),
    "invalid_request",
  );
  for (const payload of [
    { ...request.payload, unexpected: true },
    { url: "https://example.com/abs/2401.01234v2" },
    { url: "https://arxiv.org/abs/2401.01234v0" },
    { url: "https://arxiv.org/abs/2413.01234v2" },
    { url: request.payload.url, limit: 0 },
    { url: request.payload.url, limit: 101 },
    { url: request.payload.url, limit: 1.5 },
  ]) {
    expectCode(() => validateProtocolRequest({ ...request, payload }), "invalid_request");
  }
  expectCode(
    () => validateProtocolRequest({
      ...request,
      payload: { url: `https://arxiv.org/abs/2401.01234v2?${"가".repeat(1_360)}` },
    }),
    "too_large",
  );
});

test("find_local_arxiv validates source, conflicts, attachment membership, and fingerprints", () => {
  const response = responseWith();
  assert.deepEqual(validateProtocolResponse("find_local_arxiv", response), response);

  const unversioned = structuredClone(data);
  unversioned.source.version = null;
  unversioned.matches[0].evidence[0].version = null;
  assert.deepEqual(
    validateProtocolResponse("find_local_arxiv", responseWith(unversioned)),
    responseWith(unversioned),
  );

  const evidence = data.matches[0].evidence;
  const paper = data.matches[0].paper;
  const withEvidence = (nextEvidence) => responseWith({
    ...data,
    matches: [{ paper, evidence: nextEvidence }],
  });
  const invalidData = [
    { ...data, unexpected: true },
    { ...data, source: { arxivId: "2401.01234v2", version: 2 } },
    { ...data, source: { arxivId: "2401.01234", version: 0 } },
    { ...data, source: { arxivId: "2401.01234", version: 1.5 } },
    { ...data, source: { arxivId: "2401.01234" } },
    { ...data, source: { arxivId: null, version: null } },
  ];
  for (const invalid of invalidData) {
    expectCode(
      () => validateProtocolResponse("find_local_arxiv", responseWith(invalid)),
      "invalid_request",
    );
  }

  for (const [index, replacement] of [
    [1, { ...evidence[1], attachmentKey: "ATTACH01" }],
    [2, { ...evidence[2], attachmentKey: "ATTACH01" }],
    [4, { ...evidence[4], attachmentKey: "MISSING01" }],
    [5, { ...evidence[5], fingerprint: undefined }],
    [5, { ...evidence[5], fingerprint: "sha256:stale-pdf" }],
    [4, { ...evidence[4], fingerprint: "sha256:current-pdf" }],
    [3, { ...evidence[3], fingerprint: "sha256:current-pdf" }],
    [0, { ...evidence[0], arxivId: "2401.01234v1" }],
    [0, { ...evidence[0], arxivId: null }],
    [0, { ...evidence[0], version: 0 }],
  ]) {
    const next = evidence.map((entry, evidenceIndex) =>
      evidenceIndex === index ? replacement : entry,
    );
    expectCode(
      () => validateProtocolResponse("find_local_arxiv", withEvidence(next)),
      "invalid_request",
    );
  }

  expectCode(
    () => validateProtocolResponse("find_local_arxiv", withEvidence([
      { attachmentKey: null, origin: "url", arxivId: "2402.00001", version: 1 },
    ])),
    "invalid_request",
  );
});

test("find_local_arxiv returns only PDF attachments without narrowing search_papers", () => {
  const nonPdfPaper = structuredClone(data.matches[0].paper);
  nonPdfPaper.attachments[0].contentType = "text/html";

  const searchResponse = responseWith({ matches: [nonPdfPaper] });
  assert.deepEqual(
    validateProtocolResponse("search_papers", searchResponse),
    searchResponse,
  );

  expectCode(
    () => validateProtocolResponse("find_local_arxiv", responseWith({
      ...data,
      matches: [{
        paper: nonPdfPaper,
        evidence: data.matches[0].evidence,
      }],
    })),
    "invalid_request",
  );
});

test("find_local_arxiv rejects duplicate or incomplete sets instead of hiding evidence", () => {
  const match = data.matches[0];
  expectCode(
    () => validateProtocolResponse("find_local_arxiv", responseWith({
      ...data,
      matches: [match, structuredClone(match)],
    })),
    "invalid_request",
  );

  const second = structuredClone(match);
  second.paper.libraryId = "2";
  second.paper.itemKey = "ITEM0002";
  expectCode(
    () => validateProtocolResponse("find_local_arxiv", responseWith({
      ...data,
      matches: [second, match],
    })),
    "invalid_request",
  );
  expectCode(
    () => validateProtocolResponse("find_local_arxiv", responseWith({
      ...data,
      matches: [{
        paper: { ...match.paper, attachments: [...match.paper.attachments].reverse() },
        evidence: match.evidence,
      }],
    })),
    "invalid_request",
  );
  expectCode(
    () => validateProtocolResponse("find_local_arxiv", responseWith({
      ...data,
      matches: [{ ...match, evidence: [...match.evidence].reverse() }],
    })),
    "invalid_request",
  );
  expectCode(
    () => validateProtocolResponse("find_local_arxiv", responseWith({
      ...data,
      matches: [{
        paper: {
          ...match.paper,
          attachments: [match.paper.attachments[0], structuredClone(match.paper.attachments[0])],
        },
        evidence: match.evidence,
      }],
    })),
    "invalid_request",
  );
  expectCode(
    () => validateProtocolResponse("find_local_arxiv", responseWith({
      ...data,
      matches: [{ ...match, evidence: [match.evidence[0], structuredClone(match.evidence[0])] }],
    })),
    "invalid_request",
  );

  const tooMany = Array.from({ length: 101 }, (_, index) => ({
    attachmentKey: null,
    origin: "url",
    arxivId: "2401.01234",
    version: index + 1,
  }));
  expectCode(
    () => validateProtocolResponse("find_local_arxiv", responseWith({
      ...data,
      matches: [{ ...match, evidence: tooMany }],
    })),
    "too_large",
  );
});

test("find_local_arxiv orders attachment evidence by origin before child key", () => {
  const match = structuredClone(data.matches[0]);
  const parentEvidence = match.evidence.slice(0, 4);
  const firstChildUrl = match.evidence[4];
  const firstChildProvenance = match.evidence[5];
  const secondChildUrl = {
    attachmentKey: "ATTACH02",
    origin: "url",
    arxivId: "2401.01234",
    version: 2,
  };
  const documentedOrder = [
    ...parentEvidence,
    firstChildUrl,
    secondChildUrl,
    firstChildProvenance,
  ];
  const orderedResponse = responseWith({
    ...data,
    matches: [{ ...match, evidence: documentedOrder }],
  });
  assert.deepEqual(
    validateProtocolResponse("find_local_arxiv", orderedResponse),
    orderedResponse,
  );

  expectCode(
    () => validateProtocolResponse("find_local_arxiv", responseWith({
      ...data,
      matches: [{
        ...match,
        evidence: [
          ...parentEvidence,
          firstChildUrl,
          firstChildProvenance,
          secondChildUrl,
        ],
      }],
    })),
    "invalid_request",
  );
});

test("the committed schemas describe the same strict local lookup contract", async () => {
  const [requestSchema, responseSchema] = await Promise.all([
    readFile(path.join(PROTOCOL_ASSETS, "v1-request.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(PROTOCOL_ASSETS, "v1-response.schema.json"), "utf8").then(JSON.parse),
  ]);
  const validators = createProtocolSchemaValidators(requestSchema, responseSchema);
  assert.equal(validators.request(request), true, JSON.stringify(validators.request.errors));
  assert.equal(validators.response(responseWith()), true, JSON.stringify(validators.response.errors));

  const nonPdf = structuredClone(data);
  nonPdf.matches[0].paper.attachments[0].contentType = "text/html";
  assert.equal(validators.response(responseWith(nonPdf)), false);

  const invalidEvidence = structuredClone(data);
  invalidEvidence.matches[0].evidence[5].fingerprint = undefined;
  assert.equal(validators.response(responseWith(invalidEvidence)), false);
});
