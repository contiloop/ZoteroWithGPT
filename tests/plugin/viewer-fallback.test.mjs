import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerVerificationPort } from '../../dist/plugin/connection.js';

test('formatted preview errors are reported before native viewer verification runs', async () => {
  const previewError = new Error('formatted preview unavailable');
  const reported = [];
  const nativeResult = { confirmed: true, description: 'Native editor is visible' };
  const request = {
    payload: {
      libraryId: '7',
      attachmentKey: 'ATTACH01',
      annotationKey: 'ANNOT001',
    },
  };
  let nativeRequest;
  const viewer = createViewerVerificationPort({
    findAttachment: async () => ({ id: 42 }),
    readAnnotation: async () => ({ comment: 'Saved native comment' }),
    formattedPreview: {
      verifyVisiblePreview: async () => { throw previewError; },
    },
    nativeViewer: {
      verifyAnnotationInViewer: async actualRequest => {
        nativeRequest = actualRequest;
        return nativeResult;
      },
    },
    reportError: error => reported.push(error),
  });

  assert.equal(await viewer.verifyAnnotationInViewer(request), nativeResult);
  assert.deepEqual(reported, [previewError]);
  assert.equal(nativeRequest, request);
});
