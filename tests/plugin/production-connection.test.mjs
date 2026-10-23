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

test('production bridge stays local and rejects new acquisition without touching network or native data', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'production-connection-'));
  let connection;
  t.after(async () => {
    await connection?.close();
    await rm(root, { recursive: true, force: true });
  });
  const profileDirectory = path.join(root, 'profile');
  const bridgeDirectory = path.join(root, 'bridge');
  await Promise.all([mkdir(profileDirectory), mkdir(bridgeDirectory)]);
  const noteWindow = new JSDOM('').window;
  Object.defineProperty(noteWindow, 'fetch', { get() { throw new Error('network is outside the pipeline'); } });
  const environment = {
    Zotero: minimalZotero(profileDirectory), IOUtils: ioUtils(),
    PathUtils: { isAbsolute: path.isAbsolute, join: path.join, filename: path.basename, parent: path.dirname, normalize: path.normalize },
    Cc: { '@mozilla.org/file/local;1': { createInstance: () => new NativeFile() } },
    Ci: { nsIFile: { NORMAL_FILE_TYPE: 0, DIRECTORY_TYPE: 1 } },
    crypto: { subtle: webcrypto.subtle, randomUUID }, cloneInto: value => structuredClone(value),
    noteWindow, reportError: error => { throw error; },
  };
  connection = await openProductionConnection(environment, '0.4.0', bridgeDirectory, {
    inspectVisiblePreview: async () => ({ visible: false, reason: 'renderer_inactive' }),
  });
  const status = await publish(connection.subscription, {
    protocolVersion: 1, operationId: 'local.status', operation: 'connection_status', payload: {},
  });
  assert.equal(status.state, 'succeeded');
  assert.equal(status.data.capabilities.operations.length, 13);
  assert.ok(status.data.capabilities.operations.includes('find_local_arxiv'));
  for (const operation of ['inspect_arxiv', 'ensure_arxiv_pdf']) {
    assert.equal(status.data.capabilities.operations.includes(operation), false);
    const result = await publish(connection.subscription, {
      protocolVersion: 1, operationId: `retired.${operation}`, operation,
      profileId: connection.profileId,
      ...(operation === 'ensure_arxiv_pdf' ? {
        authorization: { kind: 'explicit_request', scope: 'Historical import request' },
        payload: { source: { arxivId: '2401.01234', version: 2 }, inspectionToken: 'inspection:historical', selection: { kind: 'create' } },
      } : { payload: { url: 'https://arxiv.org/abs/2401.01234v2' } }),
    });
    assert.equal(result.state, 'rejected');
    assert.equal(result.error.code, 'unsupported_capability');
  }
  const local = await publish(connection.subscription, {
    protocolVersion: 1, operationId: 'local.find', operation: 'find_local_arxiv',
    profileId: connection.profileId, payload: { url: 'https://arxiv.org/abs/2401.01234v2' },
  });
  assert.equal(local.state, 'succeeded');
  assert.deepEqual(local.data, { source: { arxivId: '2401.01234', version: 2 }, matches: [], truncated: false });
});
