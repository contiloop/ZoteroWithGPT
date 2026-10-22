import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

import {
  BoundedArxivHttpAdapter,
  DigestArxivInspectionTokens,
  GeckoArxivNetworkDriver,
} from '../../dist/adapters/arxiv/index.js';
import {
  GeckoArxivFileStore,
  GeckoArxivSynchronousFileFingerprint,
  ZoteroPdfReadability,
} from '../../dist/adapters/zotero/index.js';

test('inspection tokens deterministically bind the full source, library, and candidate snapshot', async () => {
  const digested = [];
  const tokens = new DigestArxivInspectionTokens({
    async digest(bytes) {
      const text = new TextDecoder().decode(bytes);
      digested.push(text);
      return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    },
  });
  const snapshot = {
    source: {
      arxivId: '2401.01234', version: 2,
      abstractUrl: 'https://arxiv.org/abs/2401.01234v2',
      pdfUrl: 'https://arxiv.org/pdf/2401.01234v2',
      metadata: {
        title: 'Example', authors: ['Author'], published: '2024-01-01T00:00:00Z',
        updated: '2024-01-02T00:00:00Z', abstract: '',
      },
    },
    libraryId: '1',
    candidates: [{ itemKey: 'ITEM0001', itemRevision: 'revision-a', title: 'Example', attachments: [] }],
  };
  const token = await tokens.issue(snapshot);
  assert.match(token, /^inspection:sha256:/u);
  assert.equal(await tokens.matches(token, snapshot), true);
  assert.equal(await tokens.matches(token, {
    ...snapshot,
    candidates: [{ ...snapshot.candidates[0], itemRevision: 'revision-b' }],
  }), false);
  assert.equal(digested.length, 3);
  assert.match(digested[0], /"libraryId":"1"/u);
  assert.match(digested[0], /"itemRevision":"revision-a"/u);
});

test('Gecko network driver uses manual redirects, omits credentials, bounds chunks, and cancels early return', async () => {
  const calls = [];
  let cancelled = 0;
  let released = 0;
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
  const reader = {
    async read() {
      const value = chunks.shift();
      return value === undefined ? { done: true } : { done: false, value };
    },
    async cancel() { cancelled += 1; },
    releaseLock() { released += 1; },
  };
  const driver = new GeckoArxivNetworkDriver({
    async fetch(url, init) {
      calls.push({ url, init });
      return {
        url,
        status: 200,
        headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/pdf' : null },
        body: { getReader: () => reader },
      };
    },
  });
  const controller = new AbortController();
  const response = await driver.request({
    method: 'GET', url: 'https://arxiv.org/pdf/2401.01234v2',
    headers: { Accept: 'application/pdf' }, redirect: 'manual', byteLimit: 8,
    signal: controller.signal,
  });
  const iterator = response.body[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, new Uint8Array([1, 2]));
  await iterator.return();
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.signal, controller.signal);

  const oversizedReader = {
    async read() { return { done: false, value: new Uint8Array(9) }; },
    async cancel() { cancelled += 1; },
  };
  const oversized = new GeckoArxivNetworkDriver({
    async fetch(url) {
      return { url, status: 200, headers: { get: () => null }, body: { getReader: () => oversizedReader } };
    },
  });
  const streamed = await oversized.request({
    method: 'GET', url: 'https://arxiv.org/pdf/2401.01234v2', headers: {},
    redirect: 'manual', byteLimit: 8, signal: controller.signal,
  });
  await assert.rejects(async () => {
    for await (const _chunk of streamed.body) {}
  }, /byte limit/u);
});

test('Gecko network driver normalizes a raw foreign-realm ArrayBuffer chunk', async () => {
  const owner = vm.createContext({});
  const foreignBuffer = vm.runInContext('new Uint8Array([1, 2, 3]).buffer', owner);
  assert.equal(foreignBuffer instanceof ArrayBuffer, false);
  let read = false;
  const driver = new GeckoArxivNetworkDriver({
    async fetch(url) {
      return {
        url,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            async read() {
              if (read) return { done: true };
              read = true;
              return { done: false, value: foreignBuffer };
            },
            async cancel() {},
          }),
        },
      };
    },
  });
  const response = await driver.request({
    method: 'GET', url: 'https://arxiv.org/pdf/2401.01234v2', headers: {},
    redirect: 'manual', byteLimit: 3, signal: new AbortController().signal,
  });
  const chunks = [];
  for await (const chunk of response.body) chunks.push(chunk);
  assert.deepEqual(chunks, [new Uint8Array([1, 2, 3])]);
});

test('Gecko network driver cancels a reader whose read rejects without masking the failure', async () => {
  const failure = new Error('owner-realm stream failed');
  let cancelled = 0;
  const driver = new GeckoArxivNetworkDriver({
    async fetch(url) {
      return {
        url,
        status: 200,
        headers: { get: () => null },
        body: { getReader: () => ({
          async read() { throw failure; },
          async cancel() { cancelled += 1; throw new Error('cleanup failed'); },
        }) },
      };
    },
  });
  const response = await driver.request({
    method: 'GET', url: 'https://arxiv.org/pdf/2401.01234v2', headers: {},
    redirect: 'manual', byteLimit: 3, signal: new AbortController().signal,
  });
  await assert.rejects(async () => {
    for await (const _chunk of response.body) {}
  }, error => error === failure);
  assert.equal(cancelled, 1);
});

test('composed Gecko streaming preserves nonretryable too_large for metadata and PDFs', async () => {
  for (const fixture of [
    {
      resource: { kind: 'metadata', reference: { arxivId: '2401.01234', version: 2 } },
      url: 'https://export.arxiv.org/api/query?id_list=2401.01234v2&max_results=1',
      options: { metadataByteLimit: 8 },
      stage: 'source',
    },
    {
      resource: { kind: 'pdf', source: { arxivId: '2401.01234', version: 2 } },
      url: 'https://arxiv.org/pdf/2401.01234v2',
      options: { pdfByteLimit: 8 },
      stage: 'download',
    },
  ]) {
    let cancelled = 0;
    let released = 0;
    let read = false;
    const driver = new GeckoArxivNetworkDriver({
      async fetch(url) {
        return {
          url,
          status: 200,
          headers: { get: () => null },
          body: { getReader: () => ({
            async read() {
              if (read) return { done: true };
              read = true;
              return { done: false, value: new Uint8Array(9) };
            },
            async cancel() { cancelled += 1; },
            releaseLock() { released += 1; },
          }) },
        };
      },
    });
    let error;
    try {
      await new BoundedArxivHttpAdapter(driver, fixture.options).retrieve(fixture.resource);
    } catch (caught) {
      error = caught;
    }
    assert.equal(error?.code, 'too_large');
    assert.equal(error?.retryable, false);
    assert.equal(error?.stage, fixture.stage);
    assert.match(error?.message ?? '', /byte limit/u);
    assert.equal(cancelled, 1);
    assert.equal(released, 1);
  }
});

test('PDF readability transfers an owner-realm clone and reports the worker total page count', async () => {
  const source = new Uint8Array([37, 80, 68, 70, 45]);
  let transferred;
  const worker = {
    async _enqueue(work) { return work(); },
    async _query(action, data, transfer) {
      assert.equal(action, 'pdf.getFulltext');
      assert.equal(data.maxPages, 1);
      transferred = transfer[0];
      new Uint8Array(data.buf)[0] = 0;
      return { text: '', extractedPages: 1, totalPages: 17 };
    },
  };
  const readability = new ZoteroPdfReadability({
    worker,
    cloneIntoOwner(value) {
      return structuredClone(value);
    },
  });
  assert.deepEqual(await readability.inspect(source), { pageCount: 17 });
  assert.ok(transferred instanceof ArrayBuffer);
  assert.equal(source[0], 37, 'worker transfer preparation must retain caller bytes');
});

test('PDF readability accepts a genuine foreign-realm ArrayBuffer clone', async () => {
  const owner = vm.createContext({});
  const foreignBuffer = vm.runInContext('new Uint8Array([37, 80, 68, 70, 45]).buffer', owner);
  assert.equal(foreignBuffer instanceof ArrayBuffer, false);
  const readability = new ZoteroPdfReadability({
    worker: {
      async _enqueue(work) { return work(); },
      async _query(_action, data, transfer) {
        assert.equal(Object.prototype.toString.call(data.buf), '[object ArrayBuffer]');
        assert.equal(transfer[0], data.buf);
        return { totalPages: 2 };
      },
    },
    cloneIntoOwner(value) { return { ...value, buf: foreignBuffer }; },
  });
  assert.deepEqual(await readability.inspect(new Uint8Array([37, 80, 68, 70, 45])), {
    pageCount: 2,
  });
});

test('synchronous fingerprint reads the whole bounded file and rejects a matching prefix followed by growth', () => {
  function environment(bytes, { postSize = bytes.length, extraAvailable = 0 } = {}) {
    const file = {
      exists: () => true, isSymlink: () => false, isFile: () => true,
      get fileSize() { return postSize; }, initWithPath() {},
    };
    let available = extraAvailable;
    const stream = {
      init() {}, close() {}, available: () => available,
    };
    const hash = {
      SHA256: 4,
      init() {},
      updateFromStream(_stream, count) {
        assert.equal(count, bytes.length);
        available = extraAvailable;
      },
      finish() { return String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index)); },
    };
    return {
      Cc: {
        '@mozilla.org/file/local;1': { createInstance: () => file },
        '@mozilla.org/network/file-input-stream;1': { createInstance: () => stream },
        '@mozilla.org/security/hash;1': { createInstance: () => hash },
      },
      Ci: { nsIFile: {}, nsIFileInputStream: {}, nsICryptoHash: {} },
    };
  }
  const result = new GeckoArxivSynchronousFileFingerprint(environment(new Uint8Array(5)))
    .fingerprintNow('/owned/file.pdf', 8);
  assert.deepEqual(result, {
    fingerprint: 'sha256:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    byteLength: 5,
  });
  assert.throws(
    () => new GeckoArxivSynchronousFileFingerprint(
      environment(new Uint8Array(5), { extraAvailable: 1 }),
    ).fingerprintNow('/owned/file.pdf', 8),
    /changed while it was fingerprinted/u,
  );
});

test('synchronous fingerprint distinguishes a missing path from an unreadable path', () => {
  function environment(errorName) {
    const file = {
      exists: () => false,
      isSymlink() {
        const error = new Error(errorName);
        error.name = errorName;
        throw error;
      },
      isFile: () => false,
      get fileSize() { return 0; },
      initWithPath() {},
    };
    return {
      Cc: {
        '@mozilla.org/file/local;1': { createInstance: () => file },
        '@mozilla.org/network/file-input-stream;1': { createInstance: () => ({}) },
        '@mozilla.org/security/hash;1': { createInstance: () => ({}) },
      },
      Ci: { nsIFile: {}, nsIFileInputStream: {}, nsICryptoHash: {} },
    };
  }
  assert.equal(
    new GeckoArxivSynchronousFileFingerprint(environment('NS_ERROR_FILE_NOT_FOUND'))
      .fingerprintNow('/missing.pdf', 8),
    null,
  );
  assert.throws(
    () => new GeckoArxivSynchronousFileFingerprint(environment('NS_ERROR_FILE_ACCESS_DENIED'))
      .fingerprintNow('/unreadable.pdf', 8),
    error => error?.name === 'NS_ERROR_FILE_ACCESS_DENIED',
  );
});

test('owned staging prepares asynchronously then performs one synchronous nonreplacing copy', async () => {
  const nodes = new Map();
  const unreadablePaths = new Set();
  const normalize = value => value.replaceAll('//', '/');
  class FakeFile {
    path = '';
    initWithPath(value) { this.path = normalize(value); }
    exists() { return nodes.has(this.path); }
    isSymlink() {
      if (unreadablePaths.has(this.path)) {
        const error = new Error('unreadable');
        error.name = 'NS_ERROR_FILE_ACCESS_DENIED';
        throw error;
      }
      if (!nodes.has(this.path)) {
        const error = new Error('missing');
        error.name = 'NS_ERROR_FILE_NOT_FOUND';
        throw error;
      }
      return nodes.get(this.path)?.kind === 'symlink';
    }
    isFile() { return nodes.get(this.path)?.kind === 'file'; }
    isDirectory() { return nodes.get(this.path)?.kind === 'directory'; }
    get fileSize() { return nodes.get(this.path)?.bytes?.length ?? 0; }
    create(type) {
      if (this.exists()) throw new Error('exists');
      nodes.set(this.path, { kind: type === 1 ? 'directory' : 'file', bytes: new Uint8Array() });
    }
    remove() { nodes.delete(this.path); }
    copyTo(directory, name) {
      const target = normalize(`${directory.path}/${name}`);
      if (nodes.has(target)) throw new Error('target exists');
      nodes.set(target, { kind: 'file', bytes: Uint8Array.from(nodes.get(this.path).bytes) });
    }
  }
  const io = {
    async makeDirectory(value, options) {
      const target = normalize(value);
      if (nodes.has(target) && options?.ignoreExisting === false) throw new Error('already exists');
      nodes.set(target, { kind: 'directory' });
    },
    async write(value, bytes) {
      nodes.set(normalize(value), { kind: 'file', bytes: Uint8Array.from(bytes) });
      return bytes.byteLength;
    },
  };
  class FakeInputStream {
    file;
    consumed = 0;
    init(file) { this.file = file; }
    close() {}
    available() {
      return (nodes.get(this.file.path)?.bytes?.byteLength ?? 0) - this.consumed;
    }
  }
  class FakeCryptoHash {
    SHA256 = 4;
    digest;
    init() { this.digest = createHash('sha256'); }
    updateFromStream(stream, count) {
      const bytes = nodes.get(stream.file.path).bytes;
      this.digest.update(bytes.subarray(0, count));
      stream.consumed = count;
    }
    finish() { return this.digest.digest('latin1'); }
  }
  const store = new GeckoArxivFileStore({
    IOUtils: io,
    PathUtils: { join: (...parts) => normalize(parts.join('/')) },
    Cc: {
      '@mozilla.org/file/local;1': { createInstance: () => new FakeFile() },
      '@mozilla.org/network/file-input-stream;1': { createInstance: () => new FakeInputStream() },
      '@mozilla.org/security/hash;1': { createInstance: () => new FakeCryptoHash() },
    },
    Ci: {
      nsIFile: { NORMAL_FILE_TYPE: 0, DIRECTORY_TYPE: 1 },
      nsIFileInputStream: {},
      nsICryptoHash: {},
    },
    profileDirectory: '/profile',
    generateId: () => '00000000-0000-4000-8000-000000000001',
  });
  const staged = await store.stage({
    source: { arxivId: '2401.01234', version: 2 }, contentType: 'application/pdf',
    body: new Uint8Array([1, 2, 3]),
    fingerprint: `sha256:${createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex')}`,
    byteLength: 3, pageCount: 1,
  });
  unreadablePaths.add('/storage/UNREADABLE');
  await assert.rejects(
    store.installCreateOnly(staged.stagingId, '/storage/UNREADABLE', 'paper.pdf', async create => create()),
    error => error?.name === 'NS_ERROR_FILE_ACCESS_DENIED',
  );
  unreadablePaths.delete('/storage/UNREADABLE');
  let callbackEntered = false;
  await store.installCreateOnly(staged.stagingId, '/storage/ATTACH01', '2401.01234v2.pdf', async create => {
    callbackEntered = true;
    assert.equal(nodes.has('/storage/ATTACH01'), false,
      'destination creation must remain inside the final synchronous closure');
    const result = create();
    assert.equal(result, undefined, 'commit closure must be synchronous');
  });
  assert.equal(callbackEntered, true);
  assert.deepEqual(nodes.get('/storage/ATTACH01/2401.01234v2.pdf').bytes, new Uint8Array([1, 2, 3]));
  await assert.rejects(
    store.installCreateOnly(staged.stagingId, '/storage/ATTACH01', '2401.01234v2.pdf', async create => create()),
    /already exists/u,
  );
});

test('owned staging rejects same-length tampering and does not create before the final callback', async () => {
  const nodes = new Map();
  const normalize = value => value.replaceAll('//', '/');
  class FakeFile {
    path = '';
    initWithPath(value) { this.path = normalize(value); }
    exists() { return nodes.has(this.path); }
    isSymlink() {
      if (!this.exists()) {
        const error = new Error('missing');
        error.name = 'NS_ERROR_FILE_NOT_FOUND';
        throw error;
      }
      return false;
    }
    isFile() { return nodes.get(this.path)?.kind === 'file'; }
    isDirectory() { return nodes.get(this.path)?.kind === 'directory'; }
    get fileSize() { return nodes.get(this.path)?.bytes?.length ?? 0; }
    create(type) {
      if (this.exists()) throw new Error('exists');
      nodes.set(this.path, { kind: type === 1 ? 'directory' : 'file', bytes: new Uint8Array() });
    }
    remove() { nodes.delete(this.path); }
    copyTo(directory, name) {
      nodes.set(normalize(`${directory.path}/${name}`), {
        kind: 'file', bytes: Uint8Array.from(nodes.get(this.path).bytes),
      });
    }
  }
  class FakeInputStream {
    file;
    consumed = 0;
    init(file) { this.file = file; }
    close() {}
    available() { return nodes.get(this.file.path).bytes.length - this.consumed; }
  }
  class FakeCryptoHash {
    SHA256 = 4;
    digest;
    init() { this.digest = createHash('sha256'); }
    updateFromStream(stream, count) {
      this.digest.update(nodes.get(stream.file.path).bytes.subarray(0, count));
      stream.consumed = count;
    }
    finish() { return this.digest.digest('latin1'); }
  }
  const store = new GeckoArxivFileStore({
    IOUtils: {
      async makeDirectory(value, options) {
        const target = normalize(value);
        if (nodes.has(target) && options.ignoreExisting === false) throw new Error('already exists');
        nodes.set(target, { kind: 'directory' });
      },
      async write(value, bytes) {
        nodes.set(normalize(value), { kind: 'file', bytes: Uint8Array.from(bytes) });
        return bytes.byteLength;
      },
    },
    PathUtils: { join: (...parts) => normalize(parts.join('/')) },
    Cc: {
      '@mozilla.org/file/local;1': { createInstance: () => new FakeFile() },
      '@mozilla.org/network/file-input-stream;1': { createInstance: () => new FakeInputStream() },
      '@mozilla.org/security/hash;1': { createInstance: () => new FakeCryptoHash() },
    },
    Ci: {
      nsIFile: { NORMAL_FILE_TYPE: 0, DIRECTORY_TYPE: 1 },
      nsIFileInputStream: {}, nsICryptoHash: {},
    },
    profileDirectory: '/profile',
    generateId: () => '00000000-0000-4000-8000-000000000002',
  });
  const body = new Uint8Array([1, 2, 3]);
  const staged = await store.stage({
    source: { arxivId: '2401.01234', version: 2 }, contentType: 'application/pdf', body,
    fingerprint: `sha256:${createHash('sha256').update(body).digest('hex')}`,
    byteLength: body.byteLength, pageCount: 1,
  });
  await assert.rejects(
    store.installCreateOnly(staged.stagingId, '/storage/ATTACH02', 'paper.pdf', async () => {
      throw new Error('native precommit conflict');
    }),
    /native precommit conflict/u,
  );
  assert.equal(nodes.has('/storage/ATTACH02'), false);

  nodes.get('/profile/zotero-ai-research-companion/arxiv-staging-v1/' + staged.stagingId + '.pdf')
    .bytes = new Uint8Array([3, 2, 1]);
  await assert.rejects(
    store.installCreateOnly(staged.stagingId, '/storage/ATTACH03', 'paper.pdf', async create => create()),
    /changed before installation/u,
  );
  assert.equal(nodes.has('/storage/ATTACH03'), false);
});
