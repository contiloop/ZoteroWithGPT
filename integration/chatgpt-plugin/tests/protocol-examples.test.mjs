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
  const missingFingerprint = scenarios.scenarios.find(
    (candidate) => candidate.id === "missing-fingerprint-wait-and-refresh",
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
  assert.deepEqual(missingFingerprint.expected.reads, ["find_local_arxiv"]);
  assert.deepEqual(missingFingerprint.expected.repairOperations, []);
  assert.equal(missingFingerprint.expected.readPdfBeforeFreshFingerprint, false);
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
  assert.match(workflow, /no current fingerprint[\s\S]*Do not\s+call `read_pdf`/u);
  assert.match(workflow, /complete canonical Markdown or TeX source blocks[\s\S]*by default/u);
  assert.match(workflow, /ordinary wording[\s\S]*does\s+not need to add “without summarization” or another preservation keyword/u);
  assert.match(workflow, /Reuse[\s\S]*prose verbatim[\s\S]*comparison direction[\s\S]*numerical result/u);
  assert.match(workflow, /full-content comparison,\s+not a keyword or topic check/u);
  assert.match(workflow, /presentation exception never[\s\S]*rewording prose[\s\S]*omitting a comparison outcome/u);
  assert.match(workflow, /Before assigning the mutation operation ID[\s\S]*compare it with the prepared body/u);
  assert.match(workflow, /explicitly requests a rewritten or condensed deliverable[\s\S]*requested form and output scope precisely/u);
});

test("ordinary save and explicit preservation both reject an abbreviated block", async () => {
  const scenarios = JSON.parse(
    await readFile(new URL("./scenarios.json", import.meta.url), "utf8"),
  );
  const scenario = scenarios.scenarios.find(
    (candidate) => candidate.id === "ordinary-save-reuses-complete-source-block",
  );
  const source = scenario.input.accessibleSourceBlock;
  const abbreviated = scenario.input.genericAbbreviatedCandidate;

  assert.match(source, /시간 단계마다 독립적인 정규화 통계량을 유지하는 것이 성능상 유리/u);
  assert.match(source, /gain 초기값 0\.1이 성능에 중요한 영향을/u);
  assert.match(source, /1\.0 초기값이 더 좋은 결과/u);
  assert.match(source, /구조와 데이터셋, 초기화 등에 영향을 받는다/u);
  assert.doesNotMatch(abbreviated, /성능상 유리|1\.0 초기값이 더 좋은 결과|구조와 데이터셋, 초기화/u);
  assert.equal(scenario.input.request, "방금 설명한 증명과 내 질문을 Zotero에 정리해 줘.");
  assert.doesNotMatch(scenario.input.request, /요약|생략|누락|빠짐|그대로|원문|모두|전체/u);
  assert.match(scenario.input.explicitPreservationVariant, /요약하거나 빼지 말고[\s\S]*그대로 저장/u);
  assert.equal(scenario.expected.preparedBodySource, "input.accessibleSourceBlock");
  assert.equal(scenario.expected.reuseCompleteSourceBlockByDefault, true);
  assert.equal(scenario.expected.preservationKeywordsRequired, false);
  assert.equal(scenario.expected.explicitPreservationUsesStrictCompleteSourceComparison, true);
  assert.equal(scenario.expected.proseReauthoring, false);
  assert.equal(scenario.expected.compareCompleteSourceBeforeOperationId, true);
  assert.equal(scenario.expected.genericAbbreviatedCandidateAcceptableForOrdinarySave, false);
  assert.equal(scenario.expected.genericAbbreviatedCandidateAcceptableForExplicitPreservation, false);
  assert.equal(scenario.expected.explicitRewriteOrCondense, "honor_requested_output_scope");
  assert.equal(scenario.expected.unavailableOrUnrepresentable, "reject_before_mutation");
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
    assert.match(guide, /no current fingerprint[\s\S]*do not (?:invoke|call) `read_pdf`/iu);
    assert.match(guide, /copy[\s\S]*complete canonical Markdown or TeX source by default rather\s+than[\s\S]*regenerate shorter prose/u);
    assert.match(guide, /ordinary request to save or organize[\s\S]*needs no special preservation wording/u);
    assert.match(guide, /Before\s+assigning the mutation operation ID[\s\S]*compare every requested block with the\s+prepared body/u);
    assert.match(guide, /must\s+not reword prose[\s\S]*omit a result such as which numeric\s+setting performed better/u);
    assert.match(guide, /explicitly requests a rewritten or condensed deliverable[\s\S]*requested form and output scope precisely/u);
  }
});
