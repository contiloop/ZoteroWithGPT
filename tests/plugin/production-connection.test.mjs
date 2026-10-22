import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import {
  lstatSync,
  statSync,
} from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import { openProductionConnection } from '../../dist/plugin/connection.js';

class NativeFile {
  path = '';

  initWithPath(value) { this.path = value; }

  #lstat() {
    try {
      return lstatSync(this.path);
    } catch (error) {
      if (error?.code === 'ENOENT') error.name = 'NS_ERROR_FILE_NOT_FOUND';
      throw error;
    }
  }

  exists() {
    try {
      statSync(this.path);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  isSymlink() { return this.#lstat().isSymbolicLink(); }
  isFile() { return this.#lstat().isFile(); }
  isDirectory() { return this.#lstat().isDirectory(); }
  get fileSize() { return this.#lstat().size; }
}

function ioUtils() {
  return {
    async exists(value) {
      try {
        await readFile(value);
        return true;
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
    },
    async makeDirectory(value, options = {}) {
      await mkdir(value, {
        recursive: options.createAncestors ?? true,
        mode: options.permissions ?? 0o700,
      });
    },
    async getChildren(value) {
      return (await readdir(value)).map(name => path.join(value, name));
    },
    async read(value, options = {}) {
      const bytes = await readFile(value);
      const maximum = options.maxBytes ?? bytes.byteLength;
      return new Uint8Array(bytes.subarray(0, maximum));
    },
    async write(value, bytes, options = {}) {
      if (options.tmpPath) {
        await writeFile(options.tmpPath, bytes, { mode: 0o600 });
        await rename(options.tmpPath, value);
      } else {
        await writeFile(value, bytes, { mode: 0o600 });
      }
      return bytes.byteLength;
    },
    readUTF8: value => readFile(value, 'utf8'),
    async writeUTF8(value, text, options = {}) {
      if (options.tmpPath) {
        await writeFile(options.tmpPath, text, { encoding: 'utf8', mode: 0o600 });
        await rename(options.tmpPath, value);
      } else {
        await writeFile(value, text, { encoding: 'utf8', mode: 0o600 });
      }
    },
  };
}

function minimalZotero(profileDirectory) {
  return {
    version: '10.0.6',
    Profile: { dir: profileDirectory, name: 'Production composition fixture' },
    DB: { executeTransaction: work => work(), inTransaction: () => false },
    Libraries: {
      userLibraryID: 1,
      getAll: () => [],
      get: () => ({ waitForDataLoad: async () => {} }),
    },
    Items: {
      getAll: async () => [],
      getByLibraryAndKeyAsync: async () => false,
      getAsync: async () => false,
      get: () => false,
    },
    Attachments: {
      LINK_MODE_IMPORTED_FILE: 0,
      getStorageDirectory: () => ({ path: '/unused' }),
    },
    Search: class {},
    Item: class {},
    Reader: { _readers: [], open: async () => undefined },
    Annotations: { saveFromJSON: async () => { throw new Error('unexpected write'); } },
    Relations: { getByPredicateAndObject: async () => [] },
    DataObjectUtilities: { generateKey: () => 'ITEM0001' },
    API: { getLibraryPrefix: () => 'library' },
    PDFWorker: {
      _enqueue: work => work(),
      _query: async () => ({ totalPages: 1 }),
    },
  };
}

async function publish(subscription, request) {
  const target = path.join(
    subscription.paths.requestDirectory,
    `${request.operationId}.request.json`,
  );
  const temporary = `${target}.partial`;
  await writeFile(temporary, JSON.stringify(request), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
  await subscription.pollOnce();
  return JSON.parse(await readFile(path.join(
    subscription.paths.resultDirectory,
    `${request.operationId}.result.json`,
  ), 'utf8'));
}

test('production connection binds and advertises working arXiv inspection through genuine host seams', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'production-connection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profileDirectory = path.join(root, 'profile');
  const bridgeDirectory = path.join(root, 'bridge');
  await Promise.all([mkdir(profileDirectory), mkdir(bridgeDirectory)]);

  const atom = new TextEncoder().encode(`<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>https://arxiv.org/abs/2401.01234v2</id>
        <updated>2024-02-03T04:05:06Z</updated>
        <published>2024-01-02T03:04:05Z</published>
        <title>A Strict Import Contract</title>
        <summary>Controlled composition evidence.</summary>
        <author><name>Ada Researcher</name></author>
      </entry>
    </feed>`);
  const fetchCalls = [];
  const noteWindow = new JSDOM('').window;
  Object.defineProperties(noteWindow, {
    AbortController: { value: AbortController },
    fetch: {
      value: async (url, init) => {
        fetchCalls.push({ url, init });
        let sent = false;
        return {
          url,
          status: 200,
          headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/atom+xml' : null },
          body: {
            getReader: () => ({
              async read() {
                if (sent) return { done: true };
                sent = true;
                return { done: false, value: atom };
              },
              async cancel() {},
            }),
          },
        };
      },
    },
  });
  const paths = {
    isAbsolute: path.isAbsolute,
    join: path.join,
    filename: path.basename,
    parent: path.dirname,
    normalize: path.normalize,
  };
  const connection = await openProductionConnection({
    Zotero: minimalZotero(profileDirectory),
    IOUtils: ioUtils(),
    PathUtils: paths,
    Cc: {
      '@mozilla.org/file/local;1': { createInstance: () => new NativeFile() },
      '@mozilla.org/network/file-input-stream;1': { createInstance: () => ({}) },
      '@mozilla.org/security/hash;1': { createInstance: () => ({}) },
    },
    Ci: {
      nsIFile: { NORMAL_FILE_TYPE: 0, DIRECTORY_TYPE: 1 },
      nsIFileInputStream: {},
      nsICryptoHash: {},
    },
    crypto: { subtle: webcrypto.subtle, randomUUID },
    cloneInto: value => structuredClone(value),
    noteWindow,
    reportError: error => { throw error; },
  }, '0.2.0', bridgeDirectory, {
    inspectVisiblePreview: async () => ({ visible: false, reason: 'renderer_inactive' }),
  });
  t.after(() => connection.close());

  const status = await publish(connection.subscription, {
    protocolVersion: 1,
    operationId: 'production.connection-status-1',
    operation: 'connection_status',
    payload: {},
  });
  assert.equal(status.state, 'succeeded');
  assert.equal(status.data.pluginVersion, '0.2.0');
  assert.equal(status.data.capabilities.operations.length, 14);
  assert.ok(status.data.capabilities.operations.includes('inspect_arxiv'));
  assert.ok(status.data.capabilities.operations.includes('ensure_arxiv_pdf'));

  const inspection = await publish(connection.subscription, {
    protocolVersion: 1,
    operationId: 'production.inspect-arxiv-1',
    operation: 'inspect_arxiv',
    profileId: connection.profileId,
    payload: { url: 'https://arxiv.org/abs/2401.01234v2' },
  });
  assert.equal(inspection.state, 'succeeded');
  assert.deepEqual(inspection.data.source.arxivId, '2401.01234');
  assert.equal(inspection.data.source.version, 2);
  assert.deepEqual(inspection.data.selection, { kind: 'create' });
  assert.match(inspection.data.inspectionToken, /^inspection:sha256:[0-9a-f]{64}$/u);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init.redirect, 'manual');
  assert.equal(fetchCalls[0].init.credentials, 'omit');

  await connection.close();
});
