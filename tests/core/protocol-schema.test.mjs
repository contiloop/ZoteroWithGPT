import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  validateProtocolRequest,
  validateProtocolResponse,
} from '../../dist/protocol/index.js';
import { createProtocolSchemaValidators } from '../../scripts/verify/package-lib.mjs';

const ASSET_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/package/assets/protocol',
);
const EXAMPLE_ROOT = path.join(ASSET_ROOT, 'examples');
const PROJECT_ROOT = path.resolve(ASSET_ROOT, '../../../..');

async function json(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

const [requestSchema, responseSchema] = await Promise.all([
  json(path.join(ASSET_ROOT, 'v1-request.schema.json')),
  json(path.join(ASSET_ROOT, 'v1-response.schema.json')),
]);
const validators = createProtocolSchemaValidators(requestSchema, responseSchema);

test('Draft 2020-12 validator dependencies and transitive licenses are reproducibly locked', async () => {
  const [metadata, lock] = await Promise.all([
    json(path.join(PROJECT_ROOT, 'package.json')),
    json(path.join(PROJECT_ROOT, 'package-lock.json')),
  ]);
  assert.equal(metadata.devDependencies.ajv, '8.20.0');
  assert.equal(metadata.devDependencies['ajv-formats'], '3.0.1');
  const expected = new Map([
    ['ajv', ['8.20.0', 'MIT']],
    ['ajv-formats', ['3.0.1', 'MIT']],
    ['fast-deep-equal', ['3.1.3', 'MIT']],
    ['fast-uri', ['3.1.9', 'BSD-3-Clause']],
    ['json-schema-traverse', ['1.0.0', 'MIT']],
    ['require-from-string', ['2.0.2', 'MIT']],
  ]);
  for (const [name, [version, license]] of expected) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry?.version, version, `${name} lock version`);
    assert.equal(entry?.license, license, `${name} lock license`);
  }
});

function runtimeResponseOperation(filename) {
  if (filename.startsWith('connection-status.')) return 'connection_status';
  if (filename.startsWith('create-annotation.')) return 'create_annotation';
  if (filename.startsWith('inspect-arxiv.')) return 'inspect_arxiv';
  if (filename.startsWith('ensure-arxiv-pdf.')) return 'ensure_arxiv_pdf';
  if (filename.startsWith('find-local-arxiv.')) return 'find_local_arxiv';
  throw new Error(`No runtime response operation mapping for ${filename}`);
}

function rejectedByBoth(validateSchema, validateRuntime, value) {
  assert.equal(validateSchema(value), false, 'Draft 2020-12 schema unexpectedly accepted fixture');
  assert.throws(() => validateRuntime(value));
}

test('every shipped example passes the Draft 2020-12 schema and matching runtime validator', async () => {
  const examples = (await readdir(EXAMPLE_ROOT)).filter(name => name.endsWith('.json')).sort();
  for (const filename of examples) {
    const value = await json(path.join(EXAMPLE_ROOT, filename));
    if (filename.endsWith('.request.json')) {
      assert.equal(validators.request(value), true, `${filename}: ${JSON.stringify(validators.request.errors)}`);
      assert.doesNotThrow(() => validateProtocolRequest(value), filename);
    } else {
      assert.equal(validators.response(value), true, `${filename}: ${JSON.stringify(validators.response.errors)}`);
      assert.doesNotThrow(
        () => validateProtocolResponse(runtimeResponseOperation(filename), value),
        filename,
      );
    }
  }
});

test('request schema and runtime both reject closed-shape and projected-source violations', async () => {
  const inspect = await json(path.join(EXAMPLE_ROOT, 'inspect-arxiv.request.json'));
  rejectedByBoth(validators.request, validateProtocolRequest, {
    ...inspect,
    payload: { ...inspect.payload, downloadUrl: 'https://arxiv.org/pdf/2401.01234v2' },
  });

  const ensure = await json(path.join(EXAMPLE_ROOT, 'ensure-arxiv-pdf.request.json'));
  rejectedByBoth(validators.request, validateProtocolRequest, {
    ...ensure,
    payload: {
      ...ensure.payload,
      source: {
        ...ensure.payload.source,
        metadata: { title: 'Untrusted client metadata' },
      },
    },
  });
});

test('response schema and runtime both reject lifecycle and evidence contradictions', async () => {
  const ready = await json(path.join(EXAMPLE_ROOT, 'ensure-arxiv-pdf.response.json'));
  rejectedByBoth(
    validators.response,
    value => validateProtocolResponse('ensure_arxiv_pdf', value),
    { ...ready, verification: { storage: 'not_checked', viewer: 'not_checked' } },
  );

  const itemOnly = await json(path.join(EXAMPLE_ROOT, 'ensure-arxiv-pdf.item-only.response.json'));
  rejectedByBoth(
    validators.response,
    value => validateProtocolResponse('ensure_arxiv_pdf', value),
    { ...itemOnly, state: 'succeeded', error: null },
  );
});

test('response schema and runtime both reject invalid calendar and verified-reuse evidence', async () => {
  const inspect = await json(path.join(EXAMPLE_ROOT, 'inspect-arxiv.response.json'));
  rejectedByBoth(
    validators.response,
    value => validateProtocolResponse('inspect_arxiv', value),
    {
      ...inspect,
      data: {
        ...inspect.data,
        source: {
          ...inspect.data.source,
          metadata: { ...inspect.data.source.metadata, published: '2023-02-29T03:04:05Z' },
        },
      },
    },
  );

  const candidate = {
    itemKey: 'ITEM1234',
    itemRevision: 'revision-1',
    title: 'A Strict Import Contract',
    attachments: [{
      attachmentKey: 'ATTACH01',
      fingerprint: 'sha256:verified-example',
      version: 2,
      identity: 'unverified',
    }],
  };
  rejectedByBoth(
    validators.response,
    value => validateProtocolResponse('inspect_arxiv', value),
    {
      ...inspect,
      data: {
        ...inspect.data,
        candidates: [candidate],
        decision: 'reuse',
        reason: 'Reuse one verified exact-version attachment.',
        selection: {
          kind: 'reuse',
          itemKey: candidate.itemKey,
          attachmentKey: candidate.attachments[0].attachmentKey,
          expectedFingerprint: candidate.attachments[0].fingerprint,
        },
      },
    },
  );
});
