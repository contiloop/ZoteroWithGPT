import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacyArxivRecovery } from '../../dist/adapters/zotero/legacy-arxiv-recovery.js';
import { arxivAttachmentProvenance, arxivParentProvenance, operationIdentityMarker } from '../../dist/adapters/zotero/record-utils.js';

function record() {
  const identity = { operationId: 'pre-cut.import', requestDigest: 'sha256:request' };
  const source = { arxivId: '2401.01234', version: 2 };
  return {
    ...identity, operation: 'ensure_arxiv_pdf',
    nativeEvidence: {
      stage: 'ready', source, libraryId: '1', selection: { kind: 'create' },
      itemKey: 'ITEM0001', itemAction: 'created', attachmentKey: 'ATTACH01', pdfAction: 'downloaded',
      expectedPdf: { fingerprint: 'sha256:pdf', pageCount: 2, stagingId: 'historical-stage' },
      operationMarker: operationIdentityMarker(identity), parentProvenance: arxivParentProvenance(source),
      attachmentProvenance: arxivAttachmentProvenance(source, 'sha256:pdf'),
      result: { completion: 'ready', itemKey: 'ITEM0001', attachmentKey: 'ATTACH01' },
    },
  };
}

const forbidden = new Proxy({}, { get(_, key) { throw new Error(`unexpected native call ${String(key)}`); } });

test('a historical ready checkpoint stays historical even if its object was deleted', async () => {
  const value = record();
  const recovery = new LegacyArxivRecovery(forbidden, forbidden);
  const result = await recovery.reconcile(value);
  assert.equal(result.kind, 'completed');
  assert.deepEqual(result.data, value.nativeEvidence.result);
});

test('tampered historical identity cannot become confirmed storage', async () => {
  const value = record();
  value.nativeEvidence.operationMarker = 'different-operation';
  const result = await new LegacyArxivRecovery(forbidden, forbidden).reconcile(value);
  assert.equal(result.kind, 'indeterminate');
  assert.equal(result.error.code, 'unknown_outcome');
});

test('a missing historical parent never starts acquisition or native creation', async () => {
  const value = record();
  value.nativeEvidence.stage = 'parent_committed';
  delete value.nativeEvidence.result;
  const calls = [];
  const native = {
    inspectArxiv: async () => { calls.push('inspect'); return { libraryId: '1', candidates: [] }; },
    findArxivByOperationMarker: async () => [],
    getArxivParent: async () => undefined,
  };
  const result = await new LegacyArxivRecovery(native, forbidden).reconcile(value);
  assert.equal(result.kind, 'indeterminate');
  assert.match(result.error.message, /will not be recreated/u);
  assert.equal(calls.length, 2);
});

test('a pre-cut record with no stage evidence remains unknown', async () => {
  const value = record();
  delete value.nativeEvidence;
  const result = await new LegacyArxivRecovery(forbidden, forbidden).reconcile(value);
  assert.equal(result.kind, 'indeterminate');
});
