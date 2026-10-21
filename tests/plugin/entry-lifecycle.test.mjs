import test from 'node:test';
import assert from 'node:assert/strict';

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

test('a retained settings callback cannot restart a stopped plugin', async t => {
  const enabledPreference = 'extensions.zotero-ai-research-companion.enabled';
  const directoryPreference = 'extensions.zotero-ai-research-companion.bridgeDirectory';
  const preferences = new Map([
    [enabledPreference, false],
    [directoryPreference, '/dedicated-bridge'],
  ]);
  const ioCalls = [];
  const alerts = [];
  const selections = [];
  let retainedCommand;
  let menuItem;
  const toolsMenu = { appendChild: item => { menuItem = item; } };
  const menuWindow = {
    closed: false,
    document: {
      getElementById(id) {
        if (id === 'menu_ToolsPopup') return toolsMenu;
        if (id === 'zotero-ai-research-companion-settings') return menuItem ?? null;
        return null;
      },
      createXULElement() {
        return {
          setAttribute() {},
          addEventListener(type, listener) {
            if (type === 'command') retainedCommand = listener;
          },
          removeEventListener() {},
          remove() { menuItem = undefined; },
        };
      },
    },
  };

  const installedGlobals = ['Zotero', 'IOUtils', 'PathUtils', 'Cc', 'Ci', 'Cu', 'ChromeUtils', 'Services'];
  t.after(() => {
    for (const name of installedGlobals) delete globalThis[name];
  });
  globalThis.Zotero = {
    Profile: { dir: '/profile' },
    Prefs: {
      get: name => preferences.get(name),
      set: (name, value) => preferences.set(name, value),
    },
    getMainWindow: () => null,
    getMainWindows: () => [menuWindow],
    launchURL() {},
    logError() {},
  };
  globalThis.IOUtils = new Proxy({}, {
    get(_target, property) {
      ioCalls.push(String(property));
      return async () => { throw new Error('connection opening must not be attempted'); };
    },
  });
  globalThis.PathUtils = new Proxy({ normalize: path => path }, {
    get(target, property) {
      if (property in target) return target[property];
      ioCalls.push(`PathUtils.${String(property)}`);
      return (...parts) => parts.join('/');
    },
  });
  globalThis.Cc = {};
  globalThis.Ci = {};
  globalThis.Cu = { cloneInto: value => value };
  globalThis.ChromeUtils = { importESModule: () => ({}) };
  globalThis.Services = {
    prompt: {
      BUTTON_POS_0: 1,
      BUTTON_POS_1: 256,
      BUTTON_POS_2: 65_536,
      BUTTON_TITLE_IS_STRING: 1,
      confirmEx: () => {
        assert.ok(selections.length > 0, 'unexpected settings prompt');
        return selections.shift();
      },
      alert: (_window, _title, message) => alerts.push(message),
    },
  };

  const entry = await import('../../dist/plugin/entry.js');
  await entry.start({ version: 'test-version' });
  assert.equal(typeof retainedCommand, 'function');
  await entry.stop();

  selections.push(0, 1);
  retainedCommand();
  await nextTurn();
  await nextTurn();

  assert.deepEqual(ioCalls, []);
  assert.equal(preferences.get(enabledPreference), false);
  assert.deepEqual(alerts, ['Research Companion is stopped']);
});
