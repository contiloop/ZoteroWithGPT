import assert from "node:assert/strict";
import test from "node:test";

import {
  decideArxivImport,
  validateArxivImportSelection,
} from "../../dist/core/arxiv-selection.js";
import { captureError } from "./helpers.mjs";

const source = { arxivId: "2401.01234", version: 2 };

function parent({ itemKey = "ITEM0001", itemRevision = "rev:1", attachments = [] } = {}) {
  return { itemKey, itemRevision, title: "Manually imported record", attachments };
}

function attachment({
  attachmentKey = "ATTACH01",
  fingerprint = "sha256:matching",
  version = 2,
  identity = "verified",
} = {}) {
  return { attachmentKey, fingerprint, version, identity };
}

test("automatic policy creates only with no canonical parent", () => {
  assert.deepEqual(decideArxivImport(source, []), {
    decision: "create",
    reason: "No canonical arXiv parent exists in the inspected library snapshot.",
    selection: { kind: "create" },
  });
});

test("a unique metadata-only parent is selected for attachment", () => {
  assert.deepEqual(decideArxivImport(source, [parent()]), {
    decision: "attach",
    reason: "The unique canonical parent has no competing PDF attachment.",
    selection: { kind: "attach", itemKey: "ITEM0001", expectedItemRevision: "rev:1" },
  });
});

test("a unique verified exact-version PDF is reused, including a manual import", () => {
  assert.deepEqual(decideArxivImport(source, [parent({ attachments: [attachment()] })]), {
    decision: "reuse",
    reason: "The unique PDF has verified identity, version, and fingerprint evidence.",
    selection: {
      kind: "reuse",
      itemKey: "ITEM0001",
      attachmentKey: "ATTACH01",
      expectedFingerprint: "sha256:matching",
    },
  });
});

test("duplicates, unknown provenance, version conflicts, and fingerprint ambiguity need choice", () => {
  const cases = [
    [parent({ attachments: [attachment({ version: 1 })] })],
    [parent({ attachments: [attachment({ identity: "unverified" })] })],
    [parent({ attachments: [attachment({ fingerprint: null })] })],
    [parent({ attachments: [attachment({ version: null })] })],
    [parent({ attachments: [attachment(), attachment({ attachmentKey: "ATTACH02" })] })],
    [parent(), parent({ itemKey: "ITEM0002" })],
  ];
  for (const candidates of cases) {
    const result = decideArxivImport(source, candidates);
    assert.equal(result.decision, "needs_choice");
    assert.equal("selection" in result, false);
  }

  const fingerprintConflict = decideArxivImport(
    source,
    [parent({ attachments: [attachment()] })],
    { expectedPdfFingerprint: "sha256:different" },
  );
  assert.equal(fingerprintConflict.decision, "needs_choice");
});

test("explicit choice can select an inspected parent but cannot bypass it with create", async () => {
  const candidates = [parent(), parent({ itemKey: "ITEM0002", itemRevision: "rev:2" })];
  assert.doesNotThrow(() => validateArxivImportSelection(source, candidates, {
    kind: "attach",
    itemKey: "ITEM0002",
    expectedItemRevision: "rev:2",
  }));

  const error = await captureError(async () => validateArxivImportSelection(
    source,
    candidates,
    { kind: "create" },
  ));
  assert.equal(error.code, "ambiguous_target");

  const conflict = await captureError(async () => validateArxivImportSelection(
    source,
    candidates,
    { kind: "attach", itemKey: "ITEM0002", expectedItemRevision: "rev:stale" },
  ));
  assert.equal(conflict.code, "conflict");
});

test("explicit reuse still requires current exact verified attachment evidence", async () => {
  const candidates = [parent({ attachments: [
    attachment(),
    attachment({ attachmentKey: "ATTACH02", version: 1, fingerprint: "sha256:old" }),
  ] })];
  assert.doesNotThrow(() => validateArxivImportSelection(source, candidates, {
    kind: "reuse",
    itemKey: "ITEM0001",
    attachmentKey: "ATTACH01",
    expectedFingerprint: "sha256:matching",
  }));

  for (const selection of [
    { kind: "reuse", itemKey: "ITEM0001", attachmentKey: "ATTACH01", expectedFingerprint: "sha256:stale" },
    { kind: "reuse", itemKey: "ITEM0001", attachmentKey: "ATTACH02", expectedFingerprint: "sha256:old" },
  ]) {
    const error = await captureError(async () => validateArxivImportSelection(
      source,
      candidates,
      selection,
    ));
    assert.ok(["stale_attachment", "ambiguous_target"].includes(error.code));
  }
});
