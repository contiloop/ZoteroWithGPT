import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OwnedStartupLifecycle,
  SerializedConnectionLifecycle,
} from '../../dist/plugin/lifecycle.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

test('stopping invalidates an in-flight start and closes its stale candidate', async () => {
  const opened = deferred();
  const cleaned = deferred();
  let enabled = true;
  let closeCalls = 0;
  const lifecycle = new SerializedConnectionLifecycle(async () => opened.promise);

  const starting = lifecycle.start('profile-a');
  await nextTurn();
  const stopping = lifecycle.stop();
  opened.resolve({
    close() {
      closeCalls += 1;
      enabled = false;
      return cleaned.promise;
    },
  });
  await nextTurn();

  assert.equal(enabled, false, 'the stale candidate loses authority as soon as it materializes');
  assert.equal(closeCalls, 1);
  assert.equal(lifecycle.active, undefined);

  cleaned.resolve();
  assert.deepEqual(await starting, { state: 'superseded' });
  await stopping;
  assert.equal(lifecycle.active, undefined);
});

test('replacement revokes the live connection immediately and waits for its cleanup', async () => {
  const firstCleaned = deferred();
  const events = [];
  let firstEnabled = true;
  const first = {
    close() {
      events.push('first-close-started');
      firstEnabled = false;
      return firstCleaned.promise.then(() => {
        events.push('first-close-finished');
      });
    },
  };
  const second = { close: async () => {} };
  const lifecycle = new SerializedConnectionLifecycle(async name => {
    events.push(`open-${name}`);
    return name === 'first' ? first : second;
  });

  await lifecycle.start('first');
  const replacing = lifecycle.start('second');

  assert.equal(firstEnabled, false, 'disable is synchronous even though transport cleanup is not');
  assert.deepEqual(events, ['open-first', 'first-close-started']);
  await nextTurn();
  assert.deepEqual(events, ['open-first', 'first-close-started']);

  firstCleaned.resolve();
  assert.deepEqual(await replacing, { state: 'active', connection: second });
  assert.deepEqual(events, [
    'open-first',
    'first-close-started',
    'first-close-finished',
    'open-second',
  ]);
});

test('overlapping starts never open two connection compositions concurrently', async () => {
  const firstOpened = deferred();
  const firstCleaned = deferred();
  const secondOpened = deferred();
  const calls = [];
  let factories = 0;
  let maximumFactories = 0;
  const lifecycle = new SerializedConnectionLifecycle(async name => {
    calls.push(name);
    factories += 1;
    maximumFactories = Math.max(maximumFactories, factories);
    try {
      return await (name === 'first' ? firstOpened.promise : secondOpened.promise);
    } finally {
      factories -= 1;
    }
  });

  const firstStart = lifecycle.start('first');
  await nextTurn();
  const secondStart = lifecycle.start('second');
  firstOpened.resolve({ close: () => firstCleaned.promise });
  await nextTurn();
  assert.deepEqual(calls, ['first'], 'the next factory waits for stale-candidate cleanup');

  firstCleaned.resolve();
  await nextTurn();
  assert.deepEqual(calls, ['first', 'second']);
  secondOpened.resolve({ close: async () => {} });

  assert.deepEqual(await firstStart, { state: 'superseded' });
  assert.equal((await secondStart).state, 'active');
  assert.equal(maximumFactories, 1);
});

test('an old startup rejection cannot stop or clear its replacement resource', async () => {
  const firstStarted = deferred();
  const owners = new Map();
  const createResource = owner => {
    const resource = {
      stops: 0,
      start: () => owner === 'first' ? firstStarted.promise : Promise.resolve(),
      stop() { this.stops += 1; },
    };
    owners.set(owner, resource);
    return resource;
  };
  const lifecycle = new OwnedStartupLifecycle(createResource);

  const firstAttach = lifecycle.attach('first');
  const firstFailure = assert.rejects(firstAttach, /reader startup failed/u);
  await nextTurn();
  assert.equal(lifecycle.detach('first'), true);
  assert.equal(await lifecycle.attach('replacement'), true);

  firstStarted.reject(new Error('reader startup failed'));
  await firstFailure;

  assert.equal(lifecycle.resource, owners.get('replacement'));
  assert.equal(owners.get('first').stops, 1);
  assert.equal(owners.get('replacement').stops, 0);
});
