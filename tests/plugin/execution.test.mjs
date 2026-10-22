import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeOperationExecutor } from '../../dist/plugin/execute.js';

test('unresolved anchors never reach the native writer', async () => {
  let writes = 0;
  const executor = new NativeOperationExecutor({
    anchors: { revalidate: async () => ({ status: 'unresolved', reason: 'Repeated passage' }) },
    writes: { createAnnotation: async () => { writes++; } },
  });
  const result = await executor.execute({
    operation: 'create_annotation',
    payload: { anchor: {} },
  }, { operationId: 'save-1', requestDigest: 'digest' });
  assert.equal(result.kind, 'rejected');
  assert.equal(result.error.code, 'unresolved_anchor');
  assert.equal(writes, 0);
});

test('a saved long note is read back and does not claim viewer evidence', async () => {
  const calls = [];
  const content = '긴 증명\n$$x_{n+1}=R(x_n)$$\n'.repeat(500);
  const identity = { operationId: 'save-2', requestDigest: 'digest' };
  const executor = new NativeOperationExecutor({
    writes: { createNote: async (request, actualIdentity) => {
      assert.equal(request.payload.content, content);
      assert.deepEqual(actualIdentity, identity);
      calls.push('write');
      return { noteKey: 'ABCD2345', revision: 'rev2', content, deepLink: 'zotero://note' };
    } },
    storage: { confirmNote: async (target, actualIdentity) => {
      assert.deepEqual(target, { libraryId: '1', itemKey: 'ABCD2346', noteKey: 'ABCD2345', expectedRevision: 'rev2' });
      assert.deepEqual(actualIdentity, identity);
      calls.push('readback');
      return { confirmed: true, description: 'Native API readback' };
    } },
  });
  const result = await executor.execute({ operation: 'create_note', payload: {
    libraryId: '1', itemKey: 'ABCD2346', content,
  } }, identity);
  assert.deepEqual(calls, ['write', 'readback']);
  assert.equal(result.kind, 'completed');
  assert.equal(result.data.content, content);
  assert.deepEqual(result.verification, { storage: 'confirmed', viewer: 'not_applicable' });
});

test('verification reports actual storage and reader observations separately', async () => {
  const executor = new NativeOperationExecutor({
    storage: { verifyAnnotationStorage: async () => ({ confirmed: true, description: 'Native record present' }) },
    viewer: { verifyAnnotationInViewer: async () => ({ confirmed: false, description: 'Reader annotation absent' }) },
  });
  const result = await executor.execute({ operation: 'verify_annotation', payload: { annotationKey: 'ABCD2345' } }, {});
  assert.equal(result.kind, 'completed');
  assert.deepEqual(result.verification, { storage: 'confirmed', viewer: 'failed' });
  assert.equal(result.data.viewerEvidence.confirmed, false);
});

test('readback errors after a write remain uncertain rather than rejected', async () => {
  const executor = new NativeOperationExecutor({
    writes: { createNote: async () => ({ noteKey: 'ABCD2345', revision: 'rev2', content: 'Saved', deepLink: 'zotero://note' }) },
    storage: { confirmNote: async () => { throw new Error('Readback disconnected'); } },
  });
  const result = await executor.execute({ operation: 'create_note', payload: {
    libraryId: '1', itemKey: 'ABCD2346', content: 'Saved',
  } }, { operationId: 'save-3', requestDigest: 'digest' });
  assert.equal(result.kind, 'completed');
  assert.equal(result.verification.storage, 'not_checked');
});

test('unwired arXiv operations fail closed as unsupported capabilities', async () => {
  const executor = new NativeOperationExecutor({});
  for (const request of [
    { operation: 'inspect_arxiv', payload: { url: 'https://arxiv.org/abs/2401.01234v2' } },
    {
      operation: 'ensure_arxiv_pdf',
      payload: {
        source: { arxivId: '2401.01234', version: 2 },
        inspectionToken: 'inspection:snapshot-1',
        selection: { kind: 'create' },
      },
    },
  ]) {
    const result = await executor.execute(request, {
      operationId: `unsupported-${request.operation}`,
      requestDigest: 'digest',
    });
    assert.equal(result.kind, 'rejected');
    assert.equal(result.error.code, 'unsupported_capability');
    assert.equal(result.verification.storage, 'not_checked');
  }
});
