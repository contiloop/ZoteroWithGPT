import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeOperationExecutor } from '../../dist/plugin/execute.js';
import { ArxivAcquisitionError } from '../../dist/adapters/arxiv/index.js';

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

test('unwired protocol operations fail closed as unsupported capabilities', async () => {
  const executor = new NativeOperationExecutor({});
  for (const request of [
    {
      operation: 'find_local_arxiv',
      payload: { url: 'https://arxiv.org/abs/2401.01234v2', limit: 25 },
    },
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

test('wired arXiv inspection resolves a canonical source and binds the complete native snapshot', async () => {
  const calls = [];
  const source = {
    arxivId: '2401.01234',
    version: 2,
    abstractUrl: 'https://arxiv.org/abs/2401.01234v2',
    pdfUrl: 'https://arxiv.org/pdf/2401.01234v2',
    metadata: {
      title: 'A studied paper',
      authors: ['Researcher One'],
      published: '2024-01-01T00:00:00Z',
      updated: '2024-01-02T00:00:00Z',
      abstract: 'Abstract',
    },
  };
  const candidates = [];
  const executor = new NativeOperationExecutor({}, {
    source: {
      async inspect(reference) {
        calls.push(['source', reference]);
        return source;
      },
    },
    importer: {
      captureAccessFence() { throw new Error('read inspection must not capture mutation authority'); },
      async inspect(actualSource) {
        calls.push(['native', actualSource]);
        return { libraryId: '1', candidates };
      },
    },
    tokens: {
      async issue(snapshot) {
        calls.push(['token', snapshot]);
        return 'inspection:complete-snapshot';
      },
    },
  });

  const result = await executor.execute({
    operation: 'inspect_arxiv',
    payload: { url: 'https://arxiv.org/abs/2401.01234v2' },
  }, { operationId: 'inspect-1', requestDigest: 'digest' });

  assert.equal(result.kind, 'completed');
  assert.deepEqual(result.data, {
    source,
    libraryId: '1',
    candidates,
    decision: 'create',
    reason: 'No canonical arXiv parent exists in the inspected library snapshot.',
    inspectionToken: 'inspection:complete-snapshot',
    selection: { kind: 'create' },
  });
  assert.deepEqual(calls, [
    ['source', { arxivId: '2401.01234', version: 2 }],
    ['native', source],
    ['token', { source, libraryId: '1', candidates }],
  ]);
});

test('ensure captures authority before exact-version re-resolution and forwards the same fence', async () => {
  const calls = [];
  let resolveSource;
  const sourcePending = new Promise(resolve => { resolveSource = resolve; });
  const resolved = {
    arxivId: '2401.01234', version: 2,
    abstractUrl: 'https://arxiv.org/abs/2401.01234v2',
    pdfUrl: 'https://arxiv.org/pdf/2401.01234v2',
    metadata: {
      title: 'A studied paper', authors: ['Researcher One'],
      published: '2024-01-01T00:00:00Z', updated: '2024-01-02T00:00:00Z', abstract: '',
    },
  };
  const identity = { operationId: 'ensure-1', requestDigest: 'digest' };
  const executor = new NativeOperationExecutor({}, {
    source: {
      async inspect(reference) {
        calls.push(['source-start', reference]);
        return sourcePending;
      },
    },
    importer: {
      captureAccessFence() {
        calls.push(['fence']);
        return 'authority-generation-7';
      },
      async ensure(input) {
        calls.push(['ensure', input]);
        return {
          kind: 'completed',
          data: {
            source: { arxivId: '2401.01234', version: 2 }, libraryId: '1',
            completion: 'ready', itemKey: 'ITEM0001', itemAction: 'created',
            attachmentKey: 'PDF00001', attachmentFingerprint: 'sha256:a',
            pdfAction: 'downloaded', deepLink: 'zotero://select/library/items/PDF00001',
          },
          verification: { storage: 'confirmed', viewer: 'not_checked' },
        };
      },
    },
    tokens: { async issue() { throw new Error('ensure must reuse the supplied token'); } },
  });
  const request = {
    operation: 'ensure_arxiv_pdf',
    payload: {
      source: { arxivId: '2401.01234', version: 2 },
      inspectionToken: 'inspection:complete-snapshot',
      selection: { kind: 'create' },
    },
  };
  const pending = executor.execute(request, identity);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [
    ['fence'],
    ['source-start', { arxivId: '2401.01234', version: 2 }],
  ]);
  resolveSource(resolved);
  const result = await pending;
  assert.equal(result.kind, 'completed');
  assert.deepEqual(calls[2], ['ensure', {
    source: resolved,
    selection: { kind: 'create' },
    inspectionToken: 'inspection:complete-snapshot',
    accessFence: 'authority-generation-7',
    identity,
  }]);
});

test('definite arXiv source failure before native work stays failed instead of unknown', async () => {
  let nativeCalls = 0;
  const executor = new NativeOperationExecutor({}, {
    source: {
      async inspect() {
        throw new ArxivAcquisitionError('storage_error', 'arXiv rate limited the request', {
          stage: 'source', retryable: true, retryAfterSeconds: 30,
        });
      },
    },
    importer: {
      captureAccessFence() { return 'authority-generation-1'; },
      async ensure() { nativeCalls += 1; },
    },
    tokens: { async issue() { throw new Error('not used'); } },
  });
  const result = await executor.execute({
    operation: 'ensure_arxiv_pdf',
    payload: {
      source: { arxivId: '2401.01234', version: 2 },
      inspectionToken: 'inspection:complete-snapshot',
      selection: { kind: 'create' },
    },
  }, { operationId: 'ensure-source-failure', requestDigest: 'digest' });
  assert.equal(result.kind, 'failed');
  assert.equal(result.error.code, 'storage_error');
  assert.equal(result.error.retryable, true);
  assert.deepEqual(result.verification, { storage: 'not_checked', viewer: 'not_checked' });
  assert.equal(nativeCalls, 0);
});
