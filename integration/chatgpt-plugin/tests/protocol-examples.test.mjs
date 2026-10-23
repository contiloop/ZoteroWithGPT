import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ProtocolValidationError,
  validateProtocolRequest,
} from "../../../dist/protocol/index.js";

function localLookupRequest(payload = {
  url: "https://arxiv.org/abs/2401.01234v2",
  limit: 25,
}) {
  return {
    protocolVersion: 1,
    operationId: "test.find-local.projected-source",
    operation: "find_local_arxiv",
    profileId: "profile-A",
    payload,
  };
}

test("find_local_arxiv accepts the bounded offline lookup and forbids mutation authority", () => {
  const request = localLookupRequest();
  assert.deepEqual(validateProtocolRequest(request), request);

  assert.throws(
    () => validateProtocolRequest({
      ...request,
      authorization: {
        kind: "explicit_request",
        scope: "이미 로컬에 저장된 이 논문을 함께 공부해 줘.",
      },
    }),
    (error) =>
      error instanceof ProtocolValidationError &&
      error.code === "invalid_request" &&
      /only valid for mutations/u.test(error.message),
  );
});

test("find_local_arxiv keeps URL input strict and never accepts a download instruction", () => {
  assert.throws(
    () => validateProtocolRequest(localLookupRequest({
      url: "https://arxiv.org/abs/2401.01234v2",
      limit: 25,
      download: true,
    })),
    (error) =>
      error instanceof ProtocolValidationError &&
      error.code === "invalid_request" &&
      error.message === "$.payload.download is not supported",
  );
});

test("selected-plugin scenarios require local discovery and prohibit acquisition writes", async () => {
  const scenarios = JSON.parse(
    await readFile(new URL("./scenarios.json", import.meta.url), "utf8"),
  );
  const startup = scenarios.scenarios.find(
    (candidate) => candidate.id === "selected-study-startup-read-only",
  );
  const missing = scenarios.scenarios.find(
    (candidate) => candidate.id === "missing-local-item-wait-and-refresh",
  );
  const metadataOnly = scenarios.scenarios.find(
    (candidate) => candidate.id === "metadata-only-wait-and-refresh",
  );

  assert.deepEqual(startup.expected.reads, [
    "connection_status",
    "find_local_arxiv",
    "read_pdf",
  ]);
  assert.deepEqual(startup.expected.writes, []);
  assert.deepEqual(missing.expected.acquisitionOperations, []);
  assert.deepEqual(metadataOnly.expected.acquisitionOperations, []);
  assert.equal(missing.expected.resumeWithFreshLookup, true);
  assert.equal(metadataOnly.expected.resumeWithFreshLookup, true);
});

test("workflow binds the target to discovery plus a fresh local PDF read", async () => {
  const workflow = await readFile(
    new URL("../skills/zotero-study-save/resources/workflow.md", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /Require `find_local_arxiv` in `capabilities\.operations`/u);
  assert.match(workflow, /target is established only after[\s\S]*fresh `read_pdf`/u);
  assert.match(workflow, /never invoke `inspect_arxiv` or `ensure_arxiv_pdf`/u);
  assert.match(workflow, /An unversioned URL is not a request for the latest version/u);
  assert.match(workflow, /failed switch suspends the prior implicit destination/u);
});

test("active Mac client guides keep legacy acquisition outside local study", async () => {
  const [macGuide, packagedClientGuide] = await Promise.all([
    readFile(new URL("../../mac-mcp/README.md", import.meta.url), "utf8"),
    readFile(new URL("../../../scripts/package/assets/client/README.md", import.meta.url), "utf8"),
  ]);

  for (const guide of [macGuide, packagedClientGuide]) {
    assert.match(guide, /15 operations and 5 mutations/u);
    assert.match(guide, /`find_local_arxiv`/u);
    assert.match(guide, /`inspect_arxiv`[\s\S]*`ensure_arxiv_pdf`[\s\S]*(?:outside|backward compatibility)/u);
    assert.match(guide, /Never invoke them[\s\S]*acquisition/u);
    assert.match(guide, /fresh `find_local_arxiv`[\s\S]*fresh `read_pdf`/u);
  }
});
