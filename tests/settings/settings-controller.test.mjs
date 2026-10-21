import assert from "node:assert/strict";
import test from "node:test";

import {
  ResearchCompanionSettings,
  SETTINGS_PREFERENCE_NAMES,
} from "../../dist/adapters/settings/index.js";

function fixture({ enabled = false, directory, status } = {}) {
  const preferences = new Map([
    [SETTINGS_PREFERENCE_NAMES.enabled, enabled],
    ...(directory === undefined
      ? []
      : [[SETTINGS_PREFERENCE_NAMES.bridgeDirectory, directory]]),
  ]);
  const events = [];
  const menus = new Map();
  const actions = [];
  const selectedDirectories = [];
  let runtimeStatus = status ?? { state: "disabled", detail: "Connection disabled" };
  let session = 0;

  const runtime = {
    async startConnection(selectedDirectory) {
      events.push(["start", selectedDirectory]);
      session += 1;
      runtimeStatus = {
        state: "ready",
        directory: selectedDirectory,
        sessionId: `session-${session}`,
        detail: "Listening for protocol-v1 requests",
      };
      return runtimeStatus;
    },
    async stopConnection() {
      events.push(["stop", preferences.get(SETTINGS_PREFERENCE_NAMES.enabled)]);
      runtimeStatus = { state: "disabled", detail: "Connection disabled" };
    },
    getConnectionStatus() {
      return runtimeStatus;
    },
  };

  const host = {
    getPreference(name) {
      return preferences.get(name);
    },
    setPreference(name, value) {
      preferences.set(name, value);
      events.push(["preference", name, value]);
    },
    normalizeDirectory(value) {
      events.push(["normalize", value]);
      return value.replace("/../", "/");
    },
    async chooseDirectory(_window, currentDirectory) {
      events.push(["picker", currentDirectory]);
      return selectedDirectories.shift();
    },
    addToolsMenu(window, openSettings) {
      events.push(["menu-add", window.id]);
      menus.set(window, openSettings);
      return () => {
        events.push(["menu-remove", window.id]);
        menus.delete(window);
      };
    },
    async promptAction(_window, snapshot) {
      events.push(["prompt", structuredClone(snapshot)]);
      return actions.shift() ?? "close";
    },
    showError(_window, title, message) {
      events.push(["error", title, message]);
    },
  };

  return {
    settings: new ResearchCompanionSettings({ host, runtime }),
    events,
    preferences,
    menus,
    actions,
    selectedDirectories,
    get status() { return runtimeStatus; },
  };
}

test("startup restores an enabled selected directory before any main window exists", async () => {
  const setup = fixture({ enabled: true, directory: "/Users/alice/Research Companion" });

  await setup.settings.initialize();

  assert.deepEqual(setup.events, [["start", "/Users/alice/Research Companion"]]);
  assert.equal(setup.status.state, "ready");
  assert.equal(setup.menus.size, 0);
});

test("disabled startup actively stops the runtime and window hooks own menu cleanup", async () => {
  const setup = fixture();
  const firstWindow = { id: "first" };
  const secondWindow = { id: "second" };

  await setup.settings.initialize();
  setup.settings.onMainWindowLoad(firstWindow);
  setup.settings.onMainWindowLoad(firstWindow);
  setup.settings.onMainWindowLoad(secondWindow);
  setup.settings.onMainWindowUnload(firstWindow);
  await setup.settings.shutdown();

  assert.deepEqual(
    setup.events.filter(([name]) => name === "stop"),
    [["stop", false], ["stop", false]],
  );
  assert.deepEqual(
    setup.events.filter(([name]) => name.startsWith("menu")),
    [
      ["menu-add", "first"],
      ["menu-add", "second"],
      ["menu-remove", "first"],
      ["menu-remove", "second"],
    ],
  );
  assert.equal(setup.menus.size, 0);
});

test("directory selection is normalized, displayed, and enabled only by an explicit action", async () => {
  const setup = fixture();
  const window = { id: "main" };
  setup.selectedDirectories.push("/Users/alice/tmp/../Research Companion");
  setup.actions.push("choose_directory", "enable", "close");

  await setup.settings.initialize();
  setup.settings.onMainWindowLoad(window);
  await setup.menus.get(window)();

  assert.equal(
    setup.preferences.get(SETTINGS_PREFERENCE_NAMES.bridgeDirectory),
    "/Users/alice/tmp/Research Companion",
  );
  assert.equal(setup.preferences.get(SETTINGS_PREFERENCE_NAMES.enabled), true);
  assert.deepEqual(
    setup.events.filter(([name]) => name === "start"),
    [["start", "/Users/alice/tmp/Research Companion"]],
  );
  const prompts = setup.events.filter(([name]) => name === "prompt").map(([, value]) => value);
  assert.equal(prompts[1].selectedDirectory, "/Users/alice/tmp/Research Companion");
  assert.equal(prompts[2].status.state, "ready");
  assert.match(prompts[2].diagnostics.join("\n"), /session-1/u);
});

test("disable persists the safe default before awaiting runtime shutdown", async () => {
  const setup = fixture({ enabled: true, directory: "/Users/alice/Research Companion" });
  const window = { id: "main" };
  setup.actions.push("disable", "close");

  await setup.settings.initialize();
  setup.settings.onMainWindowLoad(window);
  await setup.menus.get(window)();

  const disablePreference = setup.events.findIndex(
    (event) => event[0] === "preference" && event[1] === SETTINGS_PREFERENCE_NAMES.enabled && event[2] === false,
  );
  const stopAfterDisable = setup.events.findIndex(
    (event, index) => index > disablePreference && event[0] === "stop",
  );
  assert.ok(disablePreference >= 0);
  assert.ok(stopAfterDisable > disablePreference);
  assert.deepEqual(setup.events[stopAfterDisable], ["stop", false]);
  assert.equal(setup.status.state, "disabled");
});

test("reconnect closes the old connection and starts a fresh session in the same directory", async () => {
  const setup = fixture({ enabled: true, directory: "/Users/alice/Research Companion" });
  const window = { id: "main" };
  setup.actions.push("reconnect", "close");

  await setup.settings.initialize();
  setup.settings.onMainWindowLoad(window);
  await setup.menus.get(window)();

  assert.deepEqual(
    setup.events.filter(([name]) => name === "start" || name === "stop"),
    [
      ["start", "/Users/alice/Research Companion"],
      ["stop", false],
      ["start", "/Users/alice/Research Companion"],
    ],
  );
  assert.equal(setup.status.sessionId, "session-2");
});

test("shutdown retains setup so a new adapter starts a fresh reinstall session", async () => {
  const setup = fixture({ enabled: true, directory: "/Users/alice/Research Companion" });

  await setup.settings.initialize();
  await setup.settings.shutdown();
  const replacement = new ResearchCompanionSettings({
    host: {
      getPreference: (name) => setup.preferences.get(name),
      setPreference: (name, value) => setup.preferences.set(name, value),
      normalizeDirectory: (value) => value,
      chooseDirectory: async () => undefined,
      addToolsMenu: () => () => {},
      promptAction: async () => "close",
      showError: () => {},
    },
    runtime: {
      async startConnection(directory) {
        setup.events.push(["replacement-start", directory]);
        return { state: "ready", directory, sessionId: "replacement-session" };
      },
      async stopConnection() {},
      getConnectionStatus: () => ({ state: "disabled" }),
    },
  });
  await replacement.initialize();

  assert.equal(setup.preferences.get(SETTINGS_PREFERENCE_NAMES.enabled), true);
  assert.equal(
    setup.preferences.get(SETTINGS_PREFERENCE_NAMES.bridgeDirectory),
    "/Users/alice/Research Companion",
  );
  assert.deepEqual(
    setup.events.filter(([name]) => name === "start" || name === "replacement-start"),
    [
      ["start", "/Users/alice/Research Companion"],
      ["replacement-start", "/Users/alice/Research Companion"],
    ],
  );
  assert.equal(replacement.snapshot().status.sessionId, "replacement-session");
});

test("a failed enable is readable and does not persist an enabled startup state", async () => {
  const window = { id: "main" };
  const preferences = new Map([
    [SETTINGS_PREFERENCE_NAMES.enabled, false],
    [SETTINGS_PREFERENCE_NAMES.bridgeDirectory, "/Users/alice/Research Companion"],
  ]);
  const failures = [];
  const failed = new ResearchCompanionSettings({
    host: {
      getPreference: (name) => preferences.get(name),
      setPreference: (name, value) => preferences.set(name, value),
      normalizeDirectory: (value) => value,
      chooseDirectory: async () => undefined,
      addToolsMenu(_target, open) { failed.open = open; return () => {}; },
      promptAction: async () => actions.shift() ?? "close",
      showError: (_target, title, message) => failures.push([title, message]),
    },
    runtime: {
      async startConnection() { throw new Error("Directory is not writable"); },
      async stopConnection() {},
      getConnectionStatus: () => ({ state: "disabled" }),
    },
  });
  const actions = ["enable", "close"];
  await failed.initialize();
  failed.onMainWindowLoad(window);
  await failed.open();

  assert.equal(preferences.get(SETTINGS_PREFERENCE_NAMES.enabled), false);
  assert.deepEqual(failures, [["Research Companion", "Directory is not writable"]]);
  assert.equal(failed.snapshot().status.state, "error");
  assert.match(failed.snapshot().diagnostics.join("\n"), /Directory is not writable/u);
});
