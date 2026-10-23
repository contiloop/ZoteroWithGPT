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

import { PoliteArxivRequestAdmission } from '../../dist/adapters/arxiv/index.js';
import { openProductionConnection } from '../../dist/plugin/connection.js';

class FakeClock {
  now = 0;
  nextId = 1;
  timers = new Map();

  setTimer = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  };

  clearTimer = id => { this.timers.delete(id); };

  async advance(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (due === undefined) break;
      this.now = due[1].at;
      this.timers.delete(due[0]);
      due[1].callback();
      await Promise.resolve();
    }
    this.now = target;
    await new Promise(resolve => setImmediate(resolve));
  }
}

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
  let connectionForCleanup;
  t.after(async () => {
    await connectionForCleanup?.close();
    await rm(root, { recursive: true, force: true });
  });
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
  const clock = new FakeClock();
  const admission = new PoliteArxivRequestAdmission({
    now: () => clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const fetchCalls = [];
  const noteWindow = new JSDOM('').window;
  Object.defineProperties(noteWindow, {
    AbortController: { value: AbortController },
    fetch: {
      value: async (url, init) => {
        fetchCalls.push({ url, init, startedAt: clock.now });
        const status = fetchCalls.length === 3 ? 429 : 200;
        let sent = false;
        return {
          url,
          status,
          headers: { get: name => {
            if (name.toLowerCase() === 'content-type') return 'application/atom+xml';
            if (status === 429 && name.toLowerCase() === 'retry-after') return '120';
            return null;
          } },
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
  const environment = {
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
  };
  const previews = {
    inspectVisiblePreview: async () => ({ visible: false, reason: 'renderer_inactive' }),
  };
  const connection = await openProductionConnection(environment, '0.2.0', bridgeDirectory, previews, {
    arxivAdmission: admission,
  });
  connectionForCleanup = connection;

  const status = await publish(connection.subscription, {
    protocolVersion: 1,
    operationId: 'production.connection-status-1',
    operation: 'connection_status',
    payload: {},
  });
  assert.equal(status.state, 'succeeded');
  assert.equal(status.data.pluginVersion, '0.2.0');
  assert.equal(status.data.capabilities.operations.length, 15);
  assert.ok(status.data.capabilities.operations.includes('find_local_arxiv'));
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

  const secondPending = publish(connection.subscription, {
    protocolVersion: 1,
    operationId: 'production.inspect-arxiv-2',
    operation: 'inspect_arxiv',
    profileId: connection.profileId,
    payload: { url: 'https://arxiv.org/abs/2401.01234v2' },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetchCalls.length, 1);
  await clock.advance(2_999);
  assert.equal(fetchCalls.length, 1);
  await clock.advance(1);
  const secondInspection = await secondPending;
  assert.equal(secondInspection.state, 'succeeded');
  assert.deepEqual(fetchCalls.map(call => call.startedAt), [0, 3_000]);

  const ensurePending = publish(connection.subscription, {
    protocolVersion: 1,
    operationId: 'production.ensure-arxiv-1',
    operation: 'ensure_arxiv_pdf',
    profileId: connection.profileId,
    authorization: {
      kind: 'explicit_request',
      scope: 'Import the inspected exact arXiv version into the personal library.',
    },
    payload: {
      source: { arxivId: '2401.01234', version: 2 },
      inspectionToken: secondInspection.data.inspectionToken,
      selection: { kind: 'create' },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetchCalls.length, 2);
  await clock.advance(3_000);
  const ensure = await ensurePending;
  assert.equal(ensure.state, 'failed');
  assert.equal(ensure.error.code, 'storage_error');
  assert.equal(ensure.error.retryable, true);
  assert.deepEqual(fetchCalls.map(call => call.startedAt), [0, 3_000, 6_000]);

  await connection.close();
  connectionForCleanup = undefined;
  const reconnected = await openProductionConnection(
    environment,
    '0.2.0',
    bridgeDirectory,
    previews,
    { arxivAdmission: admission },
  );
  connectionForCleanup = reconnected;
  const cooldown = await publish(reconnected.subscription, {
    protocolVersion: 1,
    operationId: 'production.inspect-arxiv-after-429',
    operation: 'inspect_arxiv',
    profileId: reconnected.profileId,
    payload: { url: 'https://arxiv.org/abs/2401.01234v2' },
  });
  assert.equal(cooldown.state, 'failed');
  assert.equal(cooldown.error.code, 'storage_error');
  assert.equal(cooldown.error.retryable, true);
  assert.match(cooldown.error.message, /120 seconds/u);
  assert.equal(fetchCalls.length, 3, 'fresh IDs and reconnect must not bypass Retry-After');
  const local = await publish(reconnected.subscription, {
    protocolVersion: 1,
    operationId: 'production.find-local-during-429',
    operation: 'find_local_arxiv',
    profileId: reconnected.profileId,
    payload: { url: 'https://arxiv.org/abs/2401.01234v2' },
  });
  assert.equal(local.state, 'succeeded');
  assert.deepEqual(local.data, {
    source: { arxivId: '2401.01234', version: 2 }, matches: [], truncated: false,
  });
  assert.deepEqual(local.verification, { storage: 'not_applicable', viewer: 'not_applicable' });
  assert.equal(fetchCalls.length, 3, 'offline discovery must remain available during remote cooldown');
  await reconnected.close();
  connectionForCleanup = undefined;
});
