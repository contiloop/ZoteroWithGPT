import assert from "node:assert/strict";
import test from "node:test";

import {
  SETTINGS_PREFERENCE_NAMES,
  createZoteroSettingsHost,
} from "../../dist/adapters/settings/index.js";

function environment() {
  const preferences = new Map();
  const preferenceCalls = [];
  const alerts = [];
  const promptCalls = [];
  let promptResult = 2;
  let pickerResult = 0;
  let pickerFile = "/Users/alice/Research Companion";
  let lastPicker;

  class FilePicker {
    modeGetFolder = 2;
    returnOK = 0;
    file = pickerFile;
    init(parent, title, mode) {
      this.parent = parent;
      this.title = title;
      this.mode = mode;
      lastPicker = this;
    }
    async show() { return pickerResult; }
  }

  const value = {
    Zotero: {
      Prefs: {
        get(name, global) {
          preferenceCalls.push(["get", name, global]);
          return preferences.get(name);
        },
        set(name, content, global) {
          preferenceCalls.push(["set", name, content, global]);
          preferences.set(name, content);
        },
      },
      logError() {},
    },
    ChromeUtils: {
      importESModule(uri) {
        assert.equal(uri, "chrome://zotero/content/modules/filePicker.mjs");
        return { FilePicker };
      },
    },
    Services: {
      prompt: {
        BUTTON_POS_0: 1,
        BUTTON_POS_1: 256,
        BUTTON_POS_2: 65536,
        BUTTON_TITLE_IS_STRING: 127,
        confirmEx(...args) { promptCalls.push(args); return promptResult; },
        alert(...args) { alerts.push(args); },
      },
    },
    PathUtils: {
      normalize(value) { return value.replace("/tmp/../", "/"); },
    },
  };
  return {
    value,
    preferences,
    preferenceCalls,
    alerts,
    promptCalls,
    set promptResult(result) { promptResult = result; },
    set pickerResult(result) { pickerResult = result; },
    set pickerFile(value) { pickerFile = value; },
    get lastPicker() { return lastPicker; },
  };
}

function menuWindow() {
  const listeners = new Map();
  const children = [];
  const item = {
    attributes: new Map(),
    removed: false,
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
    remove() { this.removed = true; },
  };
  const tools = { appendChild(child) { children.push(child); } };
  const document = {
    getElementById(id) {
      if (id === "menu_ToolsPopup") return tools;
      if (id === "zotero-ai-research-companion-settings") {
        return children.find((child) => !child.removed) ?? null;
      }
      return null;
    },
    createXULElement(name) {
      assert.equal(name, "menuitem");
      return item;
    },
  };
  return { window: { document }, item, listeners, children };
}

test("Zotero host stores only owned preferences through the global preference branch", () => {
  const setup = environment();
  const host = createZoteroSettingsHost(setup.value);
  host.setPreference(SETTINGS_PREFERENCE_NAMES.enabled, true);

  assert.equal(host.getPreference(SETTINGS_PREFERENCE_NAMES.enabled), true);
  assert.deepEqual(setup.preferenceCalls, [
    ["set", SETTINGS_PREFERENCE_NAMES.enabled, true, true],
    ["get", SETTINGS_PREFERENCE_NAMES.enabled, true],
  ]);
  assert.throws(
    () => host.setPreference("extensions.some-other-plugin.enabled", false),
    /outside the companion namespace/u,
  );
});

test("Zotero host uses the official folder picker module and canonical path service", async () => {
  const setup = environment();
  const host = createZoteroSettingsHost(setup.value);
  const window = { document: {} };

  const selected = await host.chooseDirectory(window, "/Users/alice/Previous");

  assert.equal(selected, "/Users/alice/Research Companion");
  assert.equal(setup.lastPicker.mode, setup.lastPicker.modeGetFolder);
  assert.equal(setup.lastPicker.displayDirectory, "/Users/alice/Previous");
  assert.equal(
    await host.normalizeDirectory("/Users/alice/tmp/../Research Companion"),
    "/Users/alice/Research Companion",
  );
});

test("Zotero host attaches one removable Tools menu command", async () => {
  const setup = environment();
  const host = createZoteroSettingsHost(setup.value);
  const menu = menuWindow();
  let opened = 0;

  const remove = host.addToolsMenu(menu.window, async () => { opened += 1; });
  menu.listeners.get("command")();
  await Promise.resolve();

  assert.equal(menu.children.length, 1);
  assert.equal(menu.item.attributes.get("id"), "zotero-ai-research-companion-settings");
  assert.equal(menu.item.attributes.get("label"), "Research Companion Settings…");
  assert.equal(opened, 1);
  remove();
  assert.equal(menu.item.removed, true);
  assert.equal(menu.listeners.has("command"), false);
});

test("Zotero host displays directory, state, session, and diagnostic detail", async () => {
  const setup = environment();
  const host = createZoteroSettingsHost(setup.value);
  setup.promptResult = 1;

  const action = await host.promptAction({ document: {} }, {
    enabled: true,
    selectedDirectory: "/Users/alice/Research Companion",
    status: {
      state: "ready",
      directory: "/Users/alice/Research Companion",
      sessionId: "0123456789abcdef0123456789abcdef",
      detail: "Listening for protocol-v1 requests",
    },
    diagnostics: [
      "State: Ready",
      "Directory: /Users/alice/Research Companion",
      "Session: 0123456789abcdef0123456789abcdef",
      "Detail: Listening for protocol-v1 requests",
    ],
  });

  assert.equal(action, "reconnect");
  const call = setup.promptCalls[0];
  assert.match(call[2], /State: Ready/u);
  assert.match(call[2], /Directory: \/Users\/alice\/Research Companion/u);
  assert.match(call[2], /Session: 0123456789abcdef0123456789abcdef/u);
  assert.deepEqual(call.slice(4, 7), ["Disable", "Reconnect", "Close"]);
});
