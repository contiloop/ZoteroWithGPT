import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ProtocolValidationError,
  validateProtocolRequest,
} from "../../../dist/protocol/index.js";

const inspectionSource = {
  arxivId: "2401.01234",
  version: 2,
  abstractUrl: "https://arxiv.org/abs/2401.01234v2",
  pdfUrl: "https://arxiv.org/pdf/2401.01234v2",
  metadata: {
    title: "Example paper",
    authors: ["Example Author"],
    published: "2024-01-01T00:00:00Z",
    updated: "2024-01-02T00:00:00Z",
    abstract: "Example abstract",
  },
};

function ensureRequest(source) {
  return {
    protocolVersion: 1,
    operationId: "test.ensure.projected-source",
    operation: "ensure_arxiv_pdf",
    profileId: "profile-A",
    authorization: {
      kind: "explicit_request",
      scope: "Import the exact studied arXiv PDF for this save.",
    },
    payload: {
      source,
      inspectionToken: "inspection-token-A",
      selection: { kind: "create" },
    },
  };
}

test("ensure_arxiv_pdf accepts projected identity and rejects a full inspection source", () => {
  const projectedIdentity = {
    arxivId: inspectionSource.arxivId,
    version: inspectionSource.version,
  };
  assert.deepEqual(validateProtocolRequest(ensureRequest(projectedIdentity)).payload.source, projectedIdentity);
  assert.throws(
    () => validateProtocolRequest(ensureRequest(inspectionSource)),
    (error) =>
      error instanceof ProtocolValidationError &&
      error.code === "invalid_request" &&
      error.message === "$.payload.source.abstractUrl is not supported",
  );
});

test("workflow projects ensure source and covers abstract-path terminal .pdf normalization", async () => {
  const scenarios = JSON.parse(
    await readFile(new URL("./scenarios.json", import.meta.url), "utf8"),
  );
  const scenario = scenarios.scenarios.find(
    (candidate) => candidate.id === "abstract-dot-pdf-normalization",
  );
  assert.ok(scenario, "missing abstract-dot-pdf-normalization scenario");
  assert.equal(scenario.input.paper, "https://arxiv.org/abs/2401.01234v2.pdf?download=1#theorem");
  assert.equal(scenario.expected.normalizedSource, "canonical_https_arxiv_version");

  const workflow = await readFile(
    new URL("../skills/zotero-study-save/resources/workflow.md", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /source: \{ arxivId: inspect\.data\.source\.arxivId, version: inspect\.data\.source\.version \}/u,
  );
  assert.match(workflow, /inspectionToken: inspect\.data\.inspectionToken/u);
  assert.match(workflow, /selection: inspect\.data\.selection/u);
  assert.match(workflow, /optional terminal `\.pdf` on either recognized path/u);
});
