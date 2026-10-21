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
      inspectVisiblePreview: async () => { throw previewError; },
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

test('a failed result identifies the formatted-preview gate without exposing comment content', async () => {
  const nativeResult = {
    confirmed: false,
    description: 'Could not confirm the annotation in the native editor',
  };
  const viewer = createViewerVerificationPort({
    findAttachment: async () => ({ id: 42 }),
    readAnnotation: async () => ({ comment: 'private saved comment' }),
    formattedPreview: {
      inspectVisiblePreview: async () => ({ visible: false, reason: 'body_not_visible' }),
    },
    nativeViewer: {
      verifyAnnotationInViewer: async () => nativeResult,
    },
    reportError() {},
  });

  const result = await viewer.verifyAnnotationInViewer({
    payload: {
      libraryId: '7',
      attachmentKey: 'ATTACH01',
      annotationKey: 'ANNOT001',
    },
  });

  assert.equal(result.confirmed, false);
  assert.match(result.description, /gate "body_not_visible"/u);
  assert.doesNotMatch(result.description, /private saved comment/u);
});
