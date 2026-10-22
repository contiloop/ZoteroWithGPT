import assert from "node:assert/strict";
import test from "node:test";

import {
  DurableOperationStore,
  KeyedMutationSerializer,
} from "../../dist/adapters/operation-store/index.js";
import {
  ZoteroOperationRecovery,
} from "../../dist/adapters/zotero/index.js";
import { ZoteroArxivNativeImport } from "../../dist/adapters/zotero/arxiv-native-import.js";
import { CoreOperationError, OperationCoordinator } from "../../dist/core/index.js";
import { validateProtocolRequest } from "../../dist/protocol/index.js";

const source = {
  arxivId: "2401.01234",
  version: 2,
  abstractUrl: "https://arxiv.org/abs/2401.01234v2",
  pdfUrl: "https://arxiv.org/pdf/2401.01234v2",
  metadata: {
    title: "Fixture article",
    authors: ["Ada Example", "Grace Example"],
    published: "2024-01-03T00:00:00Z",
    updated: "2024-01-04T00:00:00Z",
    abstract: "Fixture abstract",
    doi: "10.1000/fixture",
  },
};

const verifiedPdf = {
  source: { arxivId: source.arxivId, version: source.version },
  contentType: "application/pdf",
  body: new Uint8Array([37, 80, 68, 70, 45, 1, 2, 3]),
  fingerprint: "sha256:fixture-v2",
  byteLength: 8,
  pageCount: 3,
};

function copy(value) {
  return structuredClone(value);
}

class SnapshotTokens {
  values = new Map();
  next = 1;

  async issue(snapshot) {
    const token = `inspection-${this.next++}`;
    this.values.set(token, JSON.stringify(snapshot));
    return token;
  }

  async matches(token, snapshot) {
    return this.values.get(token) === JSON.stringify(snapshot);
  }
}

class EvidenceStore {
  values = new Map();

  async checkpointNativeEvidence(operationId, evidence) {
    this.values.set(operationId, copy(evidence));
    return { nativeEvidence: copy(evidence) };
  }
}

class FixtureStaging {
  staged = 0;
  discarded = [];

  async stage(pdf) {
    this.staged += 1;
    return {
      stagingId: `owned-stage-${this.staged}`,
      source: copy(pdf.source),
      fingerprint: pdf.fingerprint,
      byteLength: pdf.byteLength,
      pageCount: pdf.pageCount,
    };
  }

  async discard(stagingId) {
    this.discarded.push(stagingId);
  }
}

class FixtureAcquisition {
  calls = 0;
  onAcquire;

  async acquire(requested) {
    this.calls += 1;
    await this.onAcquire?.();
    return { ...copy(verifiedPdf), source: copy(requested) };
  }
}

class FixtureNativeArxiv {
  enabled = true;
  generation = 0;
  nextKey = 1;
  revision = 1;
  parents = new Map();
  createParentCalls = 0;
  createAttachmentCalls = 0;
  installCalls = 0;
  inspectCalls = 0;
  parentMode = "normal";
  attachmentMode = "normal";
  installMode = "normal";
  extraMarkerObjects = [];

  disable() {
    this.enabled = false;
    this.generation += 1;
  }

  captureArxivAccessFence() {
    if (!this.enabled) throw new CoreOperationError("permission_denied", "disabled");
    return String(this.generation);
  }

  assertArxivAccessFence(fence) {
    if (!this.enabled || fence !== String(this.generation)) {
      throw new CoreOperationError("permission_denied", "access generation changed");
    }
  }

  addParent({
    itemKey = `MANUAL${this.parents.size + 1}`,
    title = "Manual metadata",
    attachments = [],
    markers = [],
    provenance = [],
    metadataMatchesSource = false,
  } = {}) {
    this.parents.set(itemKey, {
      itemKey,
      title,
      revision: this.revision++,
      deleted: false,
      markers: [...markers],
      provenance: [...provenance],
      metadataMatchesSource,
      attachments: new Map(attachments.map((entry) => [entry.attachmentKey, {
        readable: entry.readable ?? Boolean(entry.fingerprint),
        pageCount: entry.pageCount ?? (entry.fingerprint ? 1 : null),
        operationMarkers: [...(entry.operationMarkers ?? [])],
        provenanceMarkers: [...(entry.provenanceMarkers ?? [])],
        deepLink: `zotero://open-pdf/library/items/${entry.attachmentKey}`,
        deleted: false,
        ...copy(entry),
      }])),
    });
    return itemKey;
  }

  candidate(parent) {
    return {
      itemKey: parent.itemKey,
      itemRevision: `rev:${parent.revision}`,
      title: parent.title,
      attachments: [...parent.attachments.values()]
        .filter((entry) => !entry.deleted)
        .sort((left, right) => left.attachmentKey.localeCompare(right.attachmentKey))
        .map((entry) => ({
          attachmentKey: entry.attachmentKey,
          fingerprint: entry.fingerprint ?? null,
          version: entry.version ?? null,
          identity: entry.identity ?? "unverified",
        })),
    };
  }

  async inspectArxiv() {
    this.inspectCalls += 1;
    return {
      libraryId: "1",
      candidates: [...this.parents.values()]
        .filter((parent) => !parent.deleted)
        .sort((left, right) => left.itemKey.localeCompare(right.itemKey))
        .map((parent) => this.candidate(parent)),
    };
  }

  async planArxivImportKeys(createParent) {
    const suffix = String(this.nextKey++).padStart(4, "0");
    return {
      itemKey: createParent ? `ITEM${suffix}` : "unused-parent",
      attachmentKey: `PDF${suffix}`,
    };
  }

  async getArxivParent(_source, itemKey) {
    const parent = this.parents.get(itemKey);
    if (!parent || parent.deleted) return undefined;
    return {
      libraryId: "1",
      itemKey,
      itemRevision: `rev:${parent.revision}`,
      metadataRevision: `metadata:${itemKey}:${parent.title}`,
      title: parent.title,
      canonicalVersions: [source.version],
      metadataMatchesSource: parent.metadataMatchesSource,
      operationMarkers: [...parent.markers],
      provenanceMarkers: [...parent.provenance],
      deepLink: `zotero://select/library/items/${itemKey}`,
    };
  }

  async getArxivAttachment(_source, itemKey, attachmentKey) {
    const parent = this.parents.get(itemKey);
    const attachment = parent?.attachments.get(attachmentKey);
    if (!parent || parent.deleted || !attachment || attachment.deleted) return undefined;
    return {
      libraryId: "1",
      itemKey,
      attachmentKey,
      fingerprint: attachment.fingerprint ?? null,
      readable: attachment.readable ?? false,
      pageCount: attachment.pageCount ?? null,
      version: attachment.version ?? null,
      identity: attachment.identity ?? "unverified",
      operationMarkers: [...attachment.operationMarkers],
      provenanceMarkers: [...attachment.provenanceMarkers],
      deepLink: attachment.deepLink,
    };
  }

  async createArxivParent(input) {
    this.createParentCalls += 1;
    this.assertArxivAccessFence(input.accessFence);
    assert.deepEqual((await this.inspectArxiv()).candidates, input.expectedCandidates);
    if (this.parentMode === "conflict_before") {
      throw new CoreOperationError("conflict", "fixture conflict before parent save");
    }
    this.addParent({
      itemKey: input.itemKey,
      title: input.source.metadata.title,
      markers: [input.operationMarker],
      provenance: [input.parentProvenance],
      metadataMatchesSource: true,
    });
    if (this.parentMode === "commit_throw") throw new Error("fixture post-parent exception");
    return this.getArxivParent(input.source, input.itemKey);
  }

  async createArxivAttachment(input) {
    this.createAttachmentCalls += 1;
    this.assertArxivAccessFence(input.accessFence);
    assert.deepEqual((await this.inspectArxiv()).candidates, input.expectedCandidates);
    if (this.attachmentMode === "throw_before") {
      throw new Error("fixture pre-attachment exception with uncertain native boundary");
    }
    const parent = this.parents.get(input.itemKey);
    assert.ok(parent);
    parent.attachments.set(input.attachmentKey, {
      attachmentKey: input.attachmentKey,
      fingerprint: null,
      readable: false,
      pageCount: null,
      version: source.version,
      identity: "unverified",
      operationMarkers: [input.operationMarker],
      provenanceMarkers: [input.attachmentProvenance],
      deepLink: `zotero://open-pdf/library/items/${input.attachmentKey}`,
      deleted: false,
    });
    parent.revision = this.revision++;
    if (this.attachmentMode === "metadata_change") {
      parent.title = "Concurrent manual title edit";
    }
    if (this.attachmentMode === "ambiguous_commit_throw") {
      this.extraMarkerObjects.push({
        kind: "attachment",
        itemKey: input.itemKey,
        attachmentKey: "OTHERPDF",
        marker: input.operationMarker,
      });
      throw new Error("fixture ambiguous post-attachment exception");
    }
    if (this.attachmentMode === "commit_throw") {
      throw new Error("fixture post-attachment exception");
    }
    return this.getArxivAttachment(input.source, input.itemKey, input.attachmentKey);
  }

  async installArxivPdf(input) {
    this.installCalls += 1;
    this.assertArxivAccessFence(input.accessFence);
    assert.deepEqual((await this.inspectArxiv()).candidates, input.expectedCandidates);
    const parent = this.parents.get(input.itemKey);
    const attachment = parent?.attachments.get(input.attachmentKey);
    assert.ok(attachment);
    if (this.installMode === "throw") throw new Error("fixture file install failed");
    if (this.installMode === "missing") {
      attachment.fingerprint = null;
      attachment.readable = false;
      attachment.pageCount = null;
    } else if (this.installMode === "unreadable") {
      attachment.fingerprint = input.stagedPdf.fingerprint;
      attachment.readable = false;
      attachment.pageCount = null;
    } else if (this.installMode === "mismatch") {
      attachment.fingerprint = "sha256:unexpected-bytes";
      attachment.readable = true;
      attachment.pageCount = input.stagedPdf.pageCount;
      attachment.identity = "verified";
    } else {
      attachment.fingerprint = input.stagedPdf.fingerprint;
      attachment.readable = true;
      attachment.pageCount = input.stagedPdf.pageCount;
      attachment.version = input.source.version;
      attachment.identity = "verified";
    }
    parent.revision = this.revision++;
    return this.getArxivAttachment(input.source, input.itemKey, input.attachmentKey);
  }

  async findArxivByOperationMarker(marker) {
    const values = [];
    for (const parent of this.parents.values()) {
      if (parent.deleted) continue;
      if (parent.markers.includes(marker)) values.push({ kind: "parent", itemKey: parent.itemKey });
      for (const attachment of parent.attachments.values()) {
        if (!attachment.deleted && attachment.operationMarkers.includes(marker)) {
          values.push({
            kind: "attachment",
            itemKey: parent.itemKey,
            attachmentKey: attachment.attachmentKey,
          });
        }
      }
    }
    for (const entry of this.extraMarkerObjects) {
      if (entry.marker === marker) {
        const { marker: _marker, ...object } = entry;
        values.push(object);
      }
    }
    return values;
  }
}

async function fixture({ parents = [] } = {}) {
  const native = new FixtureNativeArxiv();
  for (const parent of parents) native.addParent(parent);
  const tokens = new SnapshotTokens();
  const operations = new EvidenceStore();
  const acquisition = new FixtureAcquisition();
  const staging = new FixtureStaging();
  const adapter = new ZoteroArxivNativeImport({
    native,
    acquisition,
    staging,
    tokens,
    operations,
  });
  const inspected = await native.inspectArxiv(source);
  const token = await tokens.issue({ source, ...inspected });
  return { native, tokens, operations, acquisition, staging, adapter, inspected, token };
}

function input(context, operationId, selection) {
  return {
    source,
    selection,
    inspectionToken: context.token,
    accessFence: context.adapter.captureAccessFence(),
    identity: { operationId, requestDigest: `digest-${operationId}` },
  };
}

test("fixture facade: a metadata-only canonical parent receives the exact requested PDF without metadata edits", async () => {
  const context = await fixture({
    parents: [{ itemKey: "MANUAL1", title: "Human title", attachments: [] }],
  });
  const before = copy(context.native.parents.get("MANUAL1"));
  const selection = {
    kind: "attach",
    itemKey: "MANUAL1",
    expectedItemRevision: context.inspected.candidates[0].itemRevision,
  };

  const outcome = await context.adapter.ensure(input(context, "op-metadata-only", selection));

  assert.equal(outcome.kind, "completed");
  assert.equal(outcome.data.itemAction, "reused");
  assert.equal(outcome.data.pdfAction, "downloaded");
  assert.equal(context.native.parents.get("MANUAL1").title, before.title);
  assert.deepEqual(context.native.parents.get("MANUAL1").markers, before.markers);
  assert.equal(context.native.createParentCalls, 0);
  assert.equal(context.native.createAttachmentCalls, 1);
  assert.deepEqual(context.staging.discarded, ["owned-stage-1"]);
});

test("fixture facade: verified exact reuse performs readback without adding native operation markers or changing bytes", async () => {
  const existing = {
    attachmentKey: "EXACTV2",
    fingerprint: verifiedPdf.fingerprint,
    version: source.version,
    identity: "verified",
    readable: true,
    pageCount: verifiedPdf.pageCount,
    operationMarkers: [],
    provenanceMarkers: [],
  };
  const context = await fixture({
    parents: [{ itemKey: "MANUAL1", attachments: [existing] }],
  });
  const before = copy(context.native.parents.get("MANUAL1"));
  const outcome = await context.adapter.ensure(input(context, "op-reuse-exact", {
    kind: "reuse",
    itemKey: "MANUAL1",
    attachmentKey: "EXACTV2",
    expectedFingerprint: verifiedPdf.fingerprint,
  }));

  assert.equal(outcome.kind, "completed");
  assert.equal(outcome.data.pdfAction, "reused");
  assert.equal(context.acquisition.calls, 0);
  assert.equal(context.staging.staged, 0);
  assert.equal(context.native.createParentCalls, 0);
  assert.equal(context.native.createAttachmentCalls, 0);
  assert.deepEqual(context.native.parents.get("MANUAL1"), before);
});

test("fixture facade: explicit attach cannot duplicate already acquired matching bytes with unknown provenance", async () => {
  const context = await fixture({
    parents: [{
      itemKey: "MANUAL1",
      attachments: [{
        attachmentKey: "UNVERIFIED",
        fingerprint: verifiedPdf.fingerprint,
        version: null,
        identity: "unverified",
      }],
    }],
  });
  const selection = {
    kind: "attach",
    itemKey: "MANUAL1",
    expectedItemRevision: context.inspected.candidates[0].itemRevision,
  };
  const outcome = await context.adapter.ensure(
    input(context, "op-no-matching-byte-duplicate", selection),
  );

  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error.code, "conflict");
  assert.equal(context.native.createAttachmentCalls, 0);
  assert.equal(context.native.parents.get("MANUAL1").attachments.size, 1);
});

test("fixture facade: explicit attachment allows a different version or unknown provenance while preserving it", async () => {
  for (const prior of [
    { attachmentKey: "OLDV1", fingerprint: "sha256:v1", version: 1, identity: "verified" },
    { attachmentKey: "UNKNOWN", fingerprint: "sha256:unknown", version: null, identity: "unverified" },
  ]) {
    const context = await fixture({
      parents: [{ itemKey: "MANUAL1", attachments: [prior] }],
    });
    const selection = {
      kind: "attach",
      itemKey: "MANUAL1",
      expectedItemRevision: context.inspected.candidates[0].itemRevision,
    };
    const outcome = await context.adapter.ensure(
      input(context, `op-explicit-${prior.attachmentKey}`, selection),
    );
    assert.equal(outcome.kind, "completed");
    assert.equal(context.native.parents.get("MANUAL1").attachments.has(prior.attachmentKey), true);
    assert.equal(context.native.parents.get("MANUAL1").attachments.size, 2);
  }
});

test("fixture facade: token changes during download and post-download disablement stop all native commits", async () => {
  const changed = await fixture();
  changed.acquisition.onAcquire = async () => {
    changed.native.addParent({ itemKey: "CONCURRENT" });
  };
  const changedOutcome = await changed.adapter.ensure(
    input(changed, "op-token-change", { kind: "create" }),
  );
  assert.equal(changedOutcome.kind, "rejected");
  assert.equal(changedOutcome.error.code, "conflict");
  assert.equal(changed.native.createParentCalls, 0);

  const disabled = await fixture();
  disabled.acquisition.onAcquire = async () => disabled.native.disable();
  const disabledOutcome = await disabled.adapter.ensure(
    input(disabled, "op-disable-after-download", { kind: "create" }),
  );
  assert.equal(disabledOutcome.kind, "rejected");
  assert.equal(disabledOutcome.error.code, "permission_denied");
  assert.equal(disabled.native.createParentCalls, 0);
  assert.equal(disabled.staging.staged, 0);
});

test("fixture facade: a parent metadata revision change during attachment save stops before file installation", async () => {
  const context = await fixture({
    parents: [{ itemKey: "MANUAL1", title: "Original manual title" }],
  });
  context.native.attachmentMode = "metadata_change";
  const outcome = await context.adapter.ensure(input(context, "op-parent-edit-during-save", {
    kind: "attach",
    itemKey: "MANUAL1",
    expectedItemRevision: context.inspected.candidates[0].itemRevision,
  }));

  assert.equal(outcome.kind, "indeterminate");
  assert.equal(outcome.error.code, "unknown_outcome");
  assert.equal(context.native.installCalls, 0);
  assert.equal(context.native.parents.get("MANUAL1").title, "Concurrent manual title edit");
});

test("fixture facade: failures before parent, after parent, and after attachment have bounded outcomes", async () => {
  const beforeParent = await fixture();
  beforeParent.native.parentMode = "conflict_before";
  const rejected = await beforeParent.adapter.ensure(
    input(beforeParent, "op-before-parent", { kind: "create" }),
  );
  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.error.code, "conflict");
  assert.equal("data" in rejected, false);

  const afterParent = await fixture();
  afterParent.native.attachmentMode = "throw_before";
  const parentOnly = await afterParent.adapter.ensure(
    input(afterParent, "op-after-parent", { kind: "create" }),
  );
  assert.equal(parentOnly.kind, "failed");
  assert.equal(parentOnly.data.completion, "item_only");
  assert.equal(parentOnly.data.itemAction, "created");

  const afterAttachment = await fixture();
  afterAttachment.native.installMode = "throw";
  const attachmentFailed = await afterAttachment.adapter.ensure(
    input(afterAttachment, "op-after-attachment", { kind: "create" }),
  );
  assert.equal(attachmentFailed.kind, "failed");
  assert.equal(attachmentFailed.data.completion, "item_only");
  assert.equal(afterAttachment.native.createAttachmentCalls, 1);
});

test("fixture facade: ambiguous markers and mismatched bytes are unknown, while missing or unreadable bytes are item-only", async () => {
  const ambiguous = await fixture();
  ambiguous.native.attachmentMode = "ambiguous_commit_throw";
  const ambiguousOutcome = await ambiguous.adapter.ensure(
    input(ambiguous, "op-ambiguous-markers", { kind: "create" }),
  );
  assert.equal(ambiguousOutcome.kind, "indeterminate");
  assert.equal(ambiguousOutcome.error.code, "unknown_outcome");

  for (const mode of ["missing", "unreadable"]) {
    const context = await fixture();
    context.native.installMode = mode;
    const outcome = await context.adapter.ensure(
      input(context, `op-${mode}-pdf`, { kind: "create" }),
    );
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.data.completion, "item_only");
  }

  const mismatch = await fixture();
  mismatch.native.installMode = "mismatch";
  const mismatchOutcome = await mismatch.adapter.ensure(
    input(mismatch, "op-mismatched-pdf", { kind: "create" }),
  );
  assert.equal(mismatchOutcome.kind, "indeterminate");
  assert.equal(mismatchOutcome.error.code, "unknown_outcome");
});

test("fixture facade: recovery returns historical ready, preserves deletions, and never downloads or creates", async () => {
  const successful = await fixture();
  const completed = await successful.adapter.ensure(
    input(successful, "op-ready-history", { kind: "create" }),
  );
  assert.equal(completed.kind, "completed");
  const readyEvidence = successful.operations.values.get("op-ready-history");
  const readyParent = successful.native.parents.get(readyEvidence.itemKey);
  readyParent.deleted = true;
  const beforeReadyRecovery = {
    inspect: successful.native.inspectCalls,
    acquire: successful.acquisition.calls,
    createParent: successful.native.createParentCalls,
    createAttachment: successful.native.createAttachmentCalls,
  };
  const historical = await successful.adapter.reconcile({
    operation: "ensure_arxiv_pdf",
    operationId: "op-ready-history",
    requestDigest: "digest-op-ready-history",
    nativeEvidence: readyEvidence,
  });
  assert.equal(historical.kind, "completed");
  assert.deepEqual(historical.data, completed.data);
  assert.equal(successful.native.inspectCalls, beforeReadyRecovery.inspect);
  assert.equal(successful.acquisition.calls, beforeReadyRecovery.acquire);
  assert.equal(successful.native.createParentCalls, beforeReadyRecovery.createParent);
  assert.equal(successful.native.createAttachmentCalls, beforeReadyRecovery.createAttachment);

  const interrupted = await fixture();
  interrupted.native.installMode = "throw";
  await interrupted.adapter.ensure(input(interrupted, "op-deleted-pdf", { kind: "create" }));
  const evidence = interrupted.operations.values.get("op-deleted-pdf");
  const parent = interrupted.native.parents.get(evidence.itemKey);
  parent.attachments.get(evidence.attachmentKey).deleted = true;
  const before = {
    acquire: interrupted.acquisition.calls,
    createParent: interrupted.native.createParentCalls,
    createAttachment: interrupted.native.createAttachmentCalls,
  };
  const deletedPdf = await interrupted.adapter.reconcile({
    operation: "ensure_arxiv_pdf",
    operationId: "op-deleted-pdf",
    requestDigest: "digest-op-deleted-pdf",
    nativeEvidence: evidence,
  });
  assert.equal(deletedPdf.kind, "indeterminate");
  assert.deepEqual(
    {
      acquire: interrupted.acquisition.calls,
      createParent: interrupted.native.createParentCalls,
      createAttachment: interrupted.native.createAttachmentCalls,
    },
    before,
  );
  parent.deleted = true;
  const deletedParent = await interrupted.adapter.reconcile({
    operation: "ensure_arxiv_pdf",
    operationId: "op-deleted-pdf",
    requestDigest: "digest-op-deleted-pdf",
    nativeEvidence: evidence,
  });
  assert.equal(deletedParent.kind, "indeterminate");

  const oldJournal = await interrupted.adapter.reconcile({
    operation: "ensure_arxiv_pdf",
    operationId: "op-old-journal",
    requestDigest: "digest-op-old-journal",
  });
  assert.equal(oldJournal.kind, "indeterminate");
  assert.equal(oldJournal.error.code, "unknown_outcome");
});

class MemoryAtomicFile {
  text;
  async readText() { return this.text; }
  async writeTextAtomic(text) { this.text = text; }
}

class StableDigest {
  async digest(bytes) {
    let value = 2166136261;
    for (const byte of bytes) {
      value ^= byte;
      value = Math.imul(value, 16777619);
    }
    return `test:${(value >>> 0).toString(16)}`;
  }
}

function ensureRequest(operationId, token) {
  return validateProtocolRequest({
    protocolVersion: 1,
    operationId,
    operation: "ensure_arxiv_pdf",
    profileId: "profile-A",
    authorization: {
      kind: "explicit_request",
      scope: "Import the inspected exact arXiv version into My Library.",
    },
    payload: {
      source: { arxivId: source.arxivId, version: source.version },
      inspectionToken: token,
      selection: { kind: "create" },
    },
  });
}

test("actual coordinator serialization prevents two operation IDs from creating the same parent or version PDF", async () => {
  const native = new FixtureNativeArxiv();
  const tokens = new SnapshotTokens();
  const initial = await native.inspectArxiv(source);
  const token = await tokens.issue({ source, ...initial });
  const operations = new DurableOperationStore(new MemoryAtomicFile(), {
    generateProfileId: () => "profile-A",
  });
  const acquisition = new FixtureAcquisition();
  const staging = new FixtureStaging();
  const adapter = new ZoteroArxivNativeImport({
    native,
    acquisition,
    staging,
    tokens,
    operations,
  });
  const coordinator = new OperationCoordinator({
    store: operations,
    digest: new StableDigest(),
    serializer: new KeyedMutationSerializer(),
  });
  const execute = (request, operationIdentity) =>
    adapter.ensure({
      source,
      selection: request.payload.selection,
      inspectionToken: request.payload.inspectionToken,
      accessFence: adapter.captureAccessFence(),
      identity: operationIdentity,
    });

  const [first, second] = await Promise.all([
    coordinator.submit(ensureRequest("op-cross-id-1", token), "profile-A", execute),
    coordinator.submit(ensureRequest("op-cross-id-2", token), "profile-A", execute),
  ]);

  assert.deepEqual([first.state, second.state].sort(), ["rejected", "succeeded"]);
  assert.equal(native.createParentCalls, 1);
  assert.equal(native.createAttachmentCalls, 1);
  assert.equal(native.parents.size, 1);
  assert.equal([...native.parents.values()][0].attachments.size, 1);
  assert.equal(acquisition.calls, 1);
});

test("a restarted durable ready-stage journal reconciles historically without repeating native or network work", async () => {
  const file = new MemoryAtomicFile();
  const durable = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });
  let interruptTerminal = true;
  const interruptedStore = {
    claim: (record) => durable.claim(record),
    load: (operationId) => durable.load(operationId),
    listPending: () => durable.listPending(),
    checkpointNativeEvidence: (operationId, evidence) =>
      durable.checkpointNativeEvidence(operationId, evidence),
    transition(operationId, expectedState, next) {
      if (interruptTerminal && expectedState === "running" && next.state === "succeeded") {
        interruptTerminal = false;
        throw new Error("fixture process interruption before terminal journal transition");
      }
      return durable.transition(operationId, expectedState, next);
    },
  };
  const native = new FixtureNativeArxiv();
  const tokens = new SnapshotTokens();
  const initial = await native.inspectArxiv(source);
  const token = await tokens.issue({ source, ...initial });
  const acquisition = new FixtureAcquisition();
  const staging = new FixtureStaging();
  const firstAdapter = new ZoteroArxivNativeImport({
    native,
    acquisition,
    staging,
    tokens,
    operations: interruptedStore,
  });
  const firstCoordinator = new OperationCoordinator({
    store: interruptedStore,
    digest: new StableDigest(),
    serializer: new KeyedMutationSerializer(),
  });
  const execute = (request, operationIdentity) => firstAdapter.ensure({
    source,
    selection: request.payload.selection,
    inspectionToken: request.payload.inspectionToken,
    accessFence: firstAdapter.captureAccessFence(),
    identity: operationIdentity,
  });

  await assert.rejects(
    firstCoordinator.submit(
      ensureRequest("op-restart-ready", token),
      "profile-A",
      execute,
    ),
    /fixture process interruption/,
  );
  const interrupted = await durable.load("op-restart-ready");
  assert.equal(interrupted.state, "running");
  assert.equal(interrupted.nativeEvidence.stage, "ready");
  native.parents.get(interrupted.nativeEvidence.itemKey).deleted = true;
  const before = {
    inspect: native.inspectCalls,
    acquire: acquisition.calls,
    createParent: native.createParentCalls,
    createAttachment: native.createAttachmentCalls,
  };

  const restartedStore = new DurableOperationStore(file, {
    generateProfileId: () => "must-not-replace-profile",
  });
  const restartedAdapter = new ZoteroArxivNativeImport({
    native,
    acquisition,
    staging,
    tokens,
    operations: restartedStore,
  });
  const restartedCoordinator = new OperationCoordinator({
    store: restartedStore,
    digest: new StableDigest(),
    serializer: new KeyedMutationSerializer(),
  });
  const recovery = new ZoteroOperationRecovery(native, new StableDigest(), restartedAdapter);
  const recovered = await restartedCoordinator.recoverPending("profile-A", recovery);

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].state, "succeeded");
  assert.equal(recovered[0].data.completion, "ready");
  assert.deepEqual(
    {
      inspect: native.inspectCalls,
      acquire: acquisition.calls,
      createParent: native.createParentCalls,
      createAttachment: native.createAttachmentCalls,
    },
    before,
  );
});

test("coordinator recovery reloads a ready checkpoint before its terminal transition", async () => {
  const context = await fixture();
  const operationId = "op-recovery-checkpoint";
  const completed = await context.adapter.ensure(
    input(context, operationId, { kind: "create" }),
  );
  assert.equal(completed.kind, "completed");
  const readyEvidence = context.operations.values.get(operationId);

  const file = new MemoryAtomicFile();
  const store = new DurableOperationStore(file, { generateProfileId: () => "profile-A" });
  const queued = {
    protocolVersion: 1,
    operationId,
    requestDigest: `digest-${operationId}`,
    operation: "ensure_arxiv_pdf",
    profileId: "profile-A",
    mutation: true,
    state: "queued",
    response: {
      protocolVersion: 1,
      operationId,
      state: "queued",
      data: null,
      error: null,
      verification: { storage: "not_checked", viewer: "not_checked" },
    },
  };
  const claim = await store.claim(queued);
  assert.equal(claim.kind, "created");
  const running = {
    ...queued,
    state: "running",
    response: { ...queued.response, state: "running" },
  };
  await store.transition(operationId, "queued", running);
  for (const stage of ["prepared", "parent_committed", "attachment_committed"]) {
    const { result: _result, ...withoutResult } = readyEvidence;
    await store.checkpointNativeEvidence(operationId, { ...withoutResult, stage });
  }

  const restartedAdapter = new ZoteroArxivNativeImport({
    native: context.native,
    acquisition: context.acquisition,
    staging: context.staging,
    tokens: context.tokens,
    operations: store,
  });
  const coordinator = new OperationCoordinator({
    store,
    digest: new StableDigest(),
    serializer: new KeyedMutationSerializer(),
  });
  const recovery = new ZoteroOperationRecovery(
    context.native,
    new StableDigest(),
    restartedAdapter,
  );
  const beforeAcquisitionCalls = context.acquisition.calls;

  const responses = await coordinator.recoverPending("profile-A", recovery);

  assert.equal(responses.length, 1);
  assert.equal(responses[0].state, "succeeded");
  assert.equal(responses[0].data.completion, "ready");
  assert.equal(context.acquisition.calls, beforeAcquisitionCalls);
  const recovered = await store.load(operationId);
  assert.equal(recovered.nativeEvidence.stage, "ready");
});
