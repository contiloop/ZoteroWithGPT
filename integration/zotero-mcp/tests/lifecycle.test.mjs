import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OWNED_RUNTIME_ALIAS,
  installRuntime,
  removeRuntime,
  rollbackRuntime,
  runCommand as executeCommand,
  startRuntime,
  statusRuntime,
  stopRuntime,
} from "../src/lifecycle.mjs";

async function write(root, relative, content, mode = 0o644) {
  const target = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, { mode });
  return target;
}

async function temporaryDirectory(prefix) {
  return realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function packageFixture(version) {
  const root = await temporaryDirectory("zotero-mcp-runtime-package-");
  const members = [
    "integration/zotero-mcp/lifecycle.mjs",
    "integration/zotero-mcp/package.json",
    "integration/zotero-mcp/server.mjs",
    "package-lock.json",
    "package.json",
  ];
  await write(root, "integration/zotero-mcp/package.json", `${JSON.stringify({
    name: "@zoterowithgpt/zotero-mcp",
    version,
    type: "module",
  }, null, 2)}\n`);
  await write(root, "integration/zotero-mcp/server.mjs", "process.stdin.resume();\n");
  await write(root, "integration/zotero-mcp/lifecycle.mjs", "export async function main() {}\n");
  await write(root, "package.json", `${JSON.stringify({
    name: "@zoterowithgpt/zotero-mcp-runtime",
    version,
    private: true,
    type: "module",
    engines: { node: ">=24 <27" },
  }, null, 2)}\n`);
  await write(root, "package-lock.json", `${JSON.stringify({
    name: "@zoterowithgpt/zotero-mcp-runtime",
    version,
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "@zoterowithgpt/zotero-mcp-runtime", version } },
  }, null, 2)}\n`);
  const memberSha256 = {};
  for (const member of members.sort()) {
    memberSha256[member] = createHash("sha256")
      .update(await readFile(path.join(root, ...member.split("/"))))
      .digest("hex");
  }
  await write(root, "SERVER_BUILD_METADATA.json", `${JSON.stringify({
    schemaVersion: 1,
    owner: "zotero-study-save-mcp-runtime",
    version,
    members: [...members, "SERVER_BUILD_METADATA.json"].sort(),
    memberSha256,
  }, null, 2)}\n`);
  await write(root, "node_modules/.package-lock.json", "{}\n");
  return root;
}

function tunnelFixture(calls, overrides = {}) {
  return async (executable, args, options = {}) => {
    calls.push({
      executable,
      args: [...args],
      tunnelStateRoot: options.env?.TUNNEL_CLIENT_STATE_DIR,
    });
    if (args[0] === "--version") {
      if (executable === process.execPath) {
        return { code: 0, stdout: "v24.3.0\n", stderr: "" };
      }
      return {
        code: 0,
        stdout: "0.0.14+0f870e50a973fa820d4c409000059e181e8d242b (git sha: 0f870e50a973fa820d4c409000059e181e8d242b)\n",
        stderr: "",
      };
    }
    if (args.includes("status")) {
      return {
        code: 0,
        stdout: JSON.stringify({
          alias: OWNED_RUNTIME_ALIAS,
          tunnel_id: "private-tunnel-id",
          process_running: true,
          healthy: true,
          ready: true,
          ...overrides,
        }),
        stderr: "",
      };
    }
    return { code: 0, stdout: "{}\n", stderr: "" };
  };
}

function controlledInstallDependencies(root, runCommand) {
  return {
    runCommand,
    environment: {
      HOME: root,
      XDG_STATE_HOME: path.join(root, "controlled tunnel state"),
    },
  };
}

test("owned lifecycle installs, supervises, removes, and reinstalls without touching history", async (t) => {
  const fixtureRoot = await temporaryDirectory("zotero-mcp-lifecycle-");
  const sourceRoot = await packageFixture("0.5.0");
  const installRoot = path.join(fixtureRoot, "stable runtime");
  const bridgeRoot = path.join(fixtureRoot, "private bridge");
  const profileRoot = path.join(fixtureRoot, "zotero profile");
  const credential = await write(fixtureRoot, "protected/runtime-key", "fixture-only\n", 0o600);
  const tunnelClient = await write(fixtureRoot, "bin/tunnel-client", "fixture\n", 0o700);
  const tunnelClientLink = path.join(fixtureRoot, "bin", "tunnel-client-link");
  await symlink(tunnelClient, tunnelClientLink);
  const request = await write(
    bridgeRoot,
    "sessions/retained-session/requests/retained.request.json",
    "retained bridge request\n",
  );
  const journal = await write(
    profileRoot,
    "zotero-ai-research-companion/operations-v1.json",
    "retained native journal\n",
  );
  const calls = [];
  const runCommand = tunnelFixture(calls);
  const installDependencies = controlledInstallDependencies(fixtureRoot, runCommand);
  t.after(async () => {
    await import("node:fs/promises").then(({ rm }) => Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]));
  });

  const options = {
    sourceRoot,
    installRoot,
    bridgeRoot,
    independentNode: process.execPath,
    tunnelClient: tunnelClientLink,
    tunnelId: "private-tunnel-id",
    runtimeApiKeyReference: `file:${credential}`,
  };
  const installed = await installRuntime(options, installDependencies);
  assert.equal(installed.version, "0.5.0");
  assert.equal(installed.controller, "bin/zotero-mcp-lifecycle.mjs");
  assert.doesNotMatch(
    await readFile(path.join(installRoot, installed.controller), "utf8"),
    /\.dryforge|zotero-mcp-runtime-package-/u,
  );
  const configPath = path.join(installRoot, "private", "config.json");
  assert.equal((await stat(configPath)).mode & 0o077, 0);
  const storedConfig = JSON.parse(await readFile(configPath, "utf8"));
  const unrelatedControlState = await write(
    storedConfig.tunnelStateRoot,
    "another-runtime/manual-unowned.txt",
    "shared control state\n",
  );
  assert.equal(await readFile(request, "utf8"), "retained bridge request\n");
  assert.equal(await readFile(journal, "utf8"), "retained native journal\n");

  const copiedRoot = path.join(fixtureRoot, "copied marker runtime");
  await write(
    copiedRoot,
    ".zotero-mcp-owner.json",
    await readFile(path.join(installRoot, ".zotero-mcp-owner.json"), "utf8"),
  );
  await write(
    copiedRoot,
    "private/config.json",
    await readFile(path.join(installRoot, "private", "config.json"), "utf8"),
  );
  const callsBeforeCopiedMarker = calls.length;
  await assert.rejects(statusRuntime({ installRoot: copiedRoot }, { runCommand }), /not owned/u);
  assert.equal(calls.length, callsBeforeCopiedMarker);

  const installedServer = path.join(
    installRoot,
    "releases",
    "0.5.0",
    "integration",
    "zotero-mcp",
    "server.mjs",
  );
  await writeFile(installedServer, "corrupted\n");
  await installRuntime(options, installDependencies);
  assert.equal(await readFile(installedServer, "utf8"), "process.stdin.resume();\n");

  const started = await startRuntime({ installRoot }, { runCommand });
  assert.deepEqual(started, {
    alias: OWNED_RUNTIME_ALIAS,
    processRunning: true,
    healthy: true,
    ready: true,
    version: "0.5.0",
  });
  const connect = calls.find(call => call.args.includes("connect"));
  assert.ok(connect);
  assert.deepEqual(connect.args.slice(0, 3), ["runtimes", "connect", "--alias"]);
  assert.ok(connect.args.includes("--tunnel-id"));
  assert.ok(connect.args.includes("--mcp-command"));
  assert.doesNotMatch(connect.args[connect.args.indexOf("--mcp-command") + 1], /zotero-mcp-runtime-package-/u);
  assert.equal(connect.tunnelStateRoot, storedConfig.tunnelStateRoot);

  assert.deepEqual(await statusRuntime({ installRoot }, { runCommand }), started);
  await stopRuntime({ installRoot }, { runCommand });
  const unexpected = await write(installRoot, "unowned-user-file.txt", "do not remove\n");
  const callsBeforeRejectedRemove = calls.length;
  await assert.rejects(removeRuntime({ installRoot }, { runCommand }), /unknown entry/u);
  assert.equal(calls.length, callsBeforeRejectedRemove);
  await rm(unexpected);
  await removeRuntime({ installRoot }, { runCommand });
  assert.equal(await readFile(request, "utf8"), "retained bridge request\n");
  assert.equal(await readFile(journal, "utf8"), "retained native journal\n");
  assert.equal(await readFile(unrelatedControlState, "utf8"), "shared control state\n");
  assert.ok(calls.some(call => call.args.join(" ") === `runtimes stop ${OWNED_RUNTIME_ALIAS} --json`));
  assert.ok(calls.some(call => call.args.join(" ") === `runtimes rm ${OWNED_RUNTIME_ALIAS} --json`));

  await installRuntime(options, installDependencies);
  assert.equal(await readFile(request, "utf8"), "retained bridge request\n");
  assert.equal(await readFile(journal, "utf8"), "retained native journal\n");
});

test("rollback restores the prior owned route without starting or replaying it", async (t) => {
  const fixtureRoot = await temporaryDirectory("zotero-mcp-rollback-");
  const oldSource = await packageFixture("0.4.9");
  const newSource = await packageFixture("0.5.0");
  const installRoot = path.join(fixtureRoot, "runtime");
  const bridgeA = await mkdir(path.join(fixtureRoot, "bridge-a"), { recursive: true }).then(() => path.join(fixtureRoot, "bridge-a"));
  const bridgeB = await mkdir(path.join(fixtureRoot, "bridge-b"), { recursive: true }).then(() => path.join(fixtureRoot, "bridge-b"));
  const credential = await write(fixtureRoot, "key", "fixture\n", 0o600);
  const tunnelClient = await write(fixtureRoot, "tunnel-client", "fixture\n", 0o700);
  const calls = [];
  const runCommand = tunnelFixture(calls);
  const installDependencies = controlledInstallDependencies(fixtureRoot, runCommand);
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(oldSource, { recursive: true, force: true }),
      rm(newSource, { recursive: true, force: true }),
    ]);
  });
  const common = {
    installRoot,
    independentNode: process.execPath,
    tunnelClient,
    runtimeApiKeyReference: `file:${credential}`,
  };
  await installRuntime({ ...common, sourceRoot: oldSource, bridgeRoot: bridgeA, tunnelId: "tunnel-old" }, installDependencies);
  await installRuntime({ ...common, sourceRoot: newSource, bridgeRoot: bridgeB, tunnelId: "tunnel-new" }, installDependencies);

  const before = calls.length;
  const result = await rollbackRuntime({ installRoot }, { runCommand });
  assert.deepEqual(result, { alias: OWNED_RUNTIME_ALIAS, version: "0.4.9", started: false });
  const rollbackCalls = calls.slice(before);
  assert.ok(rollbackCalls.some(call => call.args.includes("stop")));
  assert.equal(rollbackCalls.some(call => call.args.includes("connect")), false);
  const config = JSON.parse(await readFile(path.join(installRoot, "private", "config.json"), "utf8"));
  assert.equal(config.bridgeRoot, await realpath(bridgeA));
  assert.equal(config.tunnelId, "tunnel-old");
});

test("lifecycle rejects inline credentials and redacts command failures", async (t) => {
  const fixtureRoot = await temporaryDirectory("zotero-mcp-redaction-");
  const sourceRoot = await packageFixture("0.5.0");
  const bridgeRoot = path.join(fixtureRoot, "bridge");
  await mkdir(bridgeRoot);
  const tunnelClient = await write(fixtureRoot, "tunnel-client", "fixture\n", 0o700);
  const initialCommand = tunnelFixture([]);
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]);
  });

  await assert.rejects(
    installRuntime({
      sourceRoot,
      installRoot: path.join(fixtureRoot, "runtime"),
      bridgeRoot,
      independentNode: process.execPath,
      tunnelClient,
      tunnelId: "tunnel-private-value",
      runtimeApiKeyReference: "sk-proj-inline-secret-material",
    }, controlledInstallDependencies(fixtureRoot, initialCommand)),
    /file: reference/u,
  );

  const credential = await write(fixtureRoot, "protected-key", "fixture\n", 0o600);
  const runCommand = async (_executable, args) => {
    if (args[0] === "--version") return tunnelFixture([])(_executable, args);
    return {
      code: 1,
      stdout: "",
      stderr: `failed with tunnel-private-value and ${credential}`,
    };
  };
  const installRoot = path.join(fixtureRoot, "runtime-two");
  await installRuntime({
    sourceRoot,
    installRoot,
    bridgeRoot,
    independentNode: process.execPath,
    tunnelClient,
    tunnelId: "tunnel-private-value",
    runtimeApiKeyReference: `file:${credential}`,
  }, controlledInstallDependencies(fixtureRoot, runCommand));
  await assert.rejects(
    startRuntime({ installRoot }, { runCommand }),
    error => {
      assert.doesNotMatch(error.message, /tunnel-private-value/u);
      assert.doesNotMatch(error.message, /protected-key/u);
      return true;
    },
  );
});

test("installation rejects shared dependency links and install roots below symlink parents", async (t) => {
  const fixtureRoot = await temporaryDirectory("zotero-mcp-install-boundary-");
  const sourceRoot = await packageFixture("0.5.0");
  const externalDependencies = path.join(fixtureRoot, "shared dependencies");
  const bridgeRoot = path.join(fixtureRoot, "bridge");
  const canonicalInstallParent = path.join(fixtureRoot, "canonical installs");
  const linkedInstallParent = path.join(fixtureRoot, "linked installs");
  await mkdir(externalDependencies);
  await mkdir(bridgeRoot);
  await mkdir(canonicalInstallParent);
  await symlink(canonicalInstallParent, linkedInstallParent);
  const credential = await write(fixtureRoot, "protected-key", "fixture\n", 0o600);
  const tunnelClient = await write(fixtureRoot, "tunnel-client", "fixture\n", 0o700);
  const common = {
    sourceRoot,
    bridgeRoot,
    independentNode: process.execPath,
    tunnelClient,
    tunnelId: "private-tunnel-id",
    runtimeApiKeyReference: `file:${credential}`,
  };
  t.after(async () => {
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]);
  });

  await rm(path.join(sourceRoot, "node_modules"), { recursive: true, force: true });
  await symlink(externalDependencies, path.join(sourceRoot, "node_modules"));
  const runCommand = tunnelFixture([]);
  const installDependencies = controlledInstallDependencies(fixtureRoot, runCommand);
  await assert.rejects(
    installRuntime({ ...common, installRoot: path.join(canonicalInstallParent, "runtime") }, {
      ...installDependencies,
    }),
    /symlink at node_modules|dependencies are not installed/u,
  );

  await rm(path.join(sourceRoot, "node_modules"));
  await write(sourceRoot, "node_modules/.package-lock.json", "{}\n");
  await assert.rejects(
    installRuntime({ ...common, installRoot: path.join(linkedInstallParent, "runtime") }, {
      ...installDependencies,
    }),
    /symlink path component|non-symlink directory/u,
  );
});

test("installation preserves relative npm dependency links inside the owned release", async (t) => {
  const fixtureRoot = await temporaryDirectory("zotero-mcp-relative-dependency-");
  const sourceRoot = await packageFixture("0.5.0");
  const bridgeRoot = path.join(fixtureRoot, "bridge");
  await mkdir(bridgeRoot);
  await write(sourceRoot, "node_modules/mime/cli.js", "fixture cli\n");
  await mkdir(path.join(sourceRoot, "node_modules", ".bin"));
  await symlink("../mime/cli.js", path.join(sourceRoot, "node_modules", ".bin", "mime"));
  const credential = await write(fixtureRoot, "runtime-key", "fixture\n", 0o600);
  const tunnelClient = await write(fixtureRoot, "tunnel-client", "fixture\n", 0o700);
  const installRoot = path.join(fixtureRoot, "runtime");
  t.after(async () => {
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]);
  });

  await installRuntime({
    sourceRoot,
    installRoot,
    bridgeRoot,
    independentNode: process.execPath,
    tunnelClient,
    tunnelId: "private-tunnel-id",
    runtimeApiKeyReference: `file:${credential}`,
  }, controlledInstallDependencies(fixtureRoot, tunnelFixture([])));

  assert.equal(
    await readlink(path.join(installRoot, "releases", "0.5.0", "node_modules", ".bin", "mime")),
    "../mime/cli.js",
  );
});

test("private roots and credentials reject every ancestor symlink", async (t) => {
  const fixtureRoot = await temporaryDirectory("zotero-mcp-ancestor-boundary-");
  const sourceRoot = await packageFixture("0.5.0");
  const canonicalInputs = path.join(fixtureRoot, "canonical inputs");
  const linkedInputs = path.join(fixtureRoot, "linked inputs");
  const bridgeRoot = path.join(canonicalInputs, "bridge");
  await mkdir(bridgeRoot, { recursive: true });
  const credential = await write(canonicalInputs, "credentials/runtime-key", "fixture\n", 0o600);
  const tunnelClient = await write(fixtureRoot, "tunnel-client", "fixture\n", 0o700);
  await symlink(canonicalInputs, linkedInputs);
  const calls = [];
  const runCommand = tunnelFixture(calls);
  const installDependencies = controlledInstallDependencies(fixtureRoot, runCommand);
  const common = {
    sourceRoot,
    bridgeRoot,
    independentNode: process.execPath,
    tunnelClient,
    tunnelId: "private-tunnel-id",
    runtimeApiKeyReference: `file:${credential}`,
  };
  t.after(async () => {
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]);
  });

  await assert.rejects(
    installRuntime({
      ...common,
      installRoot: path.join(fixtureRoot, "runtime-via-bridge-link"),
      bridgeRoot: path.join(linkedInputs, "bridge"),
    }, installDependencies),
    /symlink path component/u,
  );
  await assert.rejects(
    installRuntime({
      ...common,
      installRoot: path.join(fixtureRoot, "runtime-via-credential-link"),
      runtimeApiKeyReference: `file:${path.join(linkedInputs, "credentials", "runtime-key")}`,
    }, installDependencies),
    /symlink path component/u,
  );

  const ownedRoot = path.join(canonicalInputs, "owned runtime");
  await installRuntime({ ...common, installRoot: ownedRoot }, installDependencies);
  await assert.rejects(
    installRuntime({
      ...common,
      installRoot: path.join(linkedInputs, "owned runtime"),
    }, installDependencies),
    /symlink path component/u,
  );
});

test("removal rejects unknown dependency and private-profile entries", async (t) => {
  const fixtureRoot = await temporaryDirectory("zotero-mcp-nested-ownership-");
  const sourceRoot = await packageFixture("0.5.0");
  const bridgeRoot = path.join(fixtureRoot, "bridge");
  await mkdir(bridgeRoot);
  const credential = await write(fixtureRoot, "runtime-key", "fixture\n", 0o600);
  const tunnelClient = await write(fixtureRoot, "tunnel-client", "fixture\n", 0o700);
  const calls = [];
  const runCommand = tunnelFixture(calls);
  const installDependencies = controlledInstallDependencies(fixtureRoot, runCommand);
  const common = {
    sourceRoot,
    bridgeRoot,
    independentNode: process.execPath,
    tunnelClient,
    tunnelId: "private-tunnel-id",
    runtimeApiKeyReference: `file:${credential}`,
  };
  t.after(async () => {
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]);
  });

  for (const [name, relative] of [
    ["dependency", "releases/0.5.0/node_modules/manual-unowned.txt"],
    ["private profile", "private/tunnel-profiles/manual-unowned.txt"],
  ]) {
    const installRoot = path.join(fixtureRoot, `${name} runtime`);
    await installRuntime({ ...common, installRoot }, installDependencies);
    const unowned = await write(installRoot, relative, "do not remove\n");
    const callsBeforeRemove = calls.length;
    await assert.rejects(
      removeRuntime({ installRoot }, { runCommand }),
      /unknown|inventory/u,
    );
    assert.equal(calls.length, callsBeforeRemove);
    assert.equal(await readFile(unowned, "utf8"), "do not remove\n");
  }
});

test("install and bridge roots stay outside the pinned tunnel control root", async (t) => {
  const fixtureRoot = await temporaryDirectory("zotero-mcp-control-root-");
  const sourceRoot = await packageFixture("0.5.0");
  const bridgeRoot = path.join(fixtureRoot, "bridge");
  await mkdir(bridgeRoot);
  const credential = await write(fixtureRoot, "runtime-key", "fixture\n", 0o600);
  const tunnelClient = await write(fixtureRoot, "tunnel-client", "fixture\n", 0o700);
  const runCommand = tunnelFixture([]);
  const common = {
    sourceRoot,
    bridgeRoot,
    independentNode: process.execPath,
    tunnelClient,
    tunnelId: "private-tunnel-id",
    runtimeApiKeyReference: `file:${credential}`,
  };
  t.after(async () => {
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]);
  });

  const stateA = path.join(fixtureRoot, "state-a");
  await mkdir(stateA);
  await assert.rejects(
    installRuntime({ ...common, installRoot: path.join(stateA, "runtime") }, {
      runCommand,
      environment: { HOME: fixtureRoot, TUNNEL_CLIENT_STATE_DIR: stateA },
    }),
    /tunnel control root/u,
  );

  const stateB = path.join(fixtureRoot, "state-b");
  await mkdir(stateB);
  await assert.rejects(
    installRuntime({
      ...common,
      installRoot: path.join(fixtureRoot, "separate runtime"),
      bridgeRoot: stateB,
    }, {
      runCommand,
      environment: { HOME: fixtureRoot, TUNNEL_CLIENT_STATE_DIR: stateB },
    }),
    /tunnel control root/u,
  );
});

test("all lifecycle entries reject a symlinked private-directory ancestor before tunnel calls", async (t) => {
  const fixtureRoot = await temporaryDirectory("zotero-mcp-private-ancestor-");
  const sourceRoot = await packageFixture("0.5.0");
  const bridgeRoot = path.join(fixtureRoot, "bridge");
  await mkdir(bridgeRoot);
  const credential = await write(fixtureRoot, "runtime-key", "fixture\n", 0o600);
  const tunnelClient = await write(fixtureRoot, "tunnel-client", "fixture\n", 0o700);
  const installRoot = path.join(fixtureRoot, "runtime");
  const calls = [];
  const runCommand = tunnelFixture(calls);
  t.after(async () => {
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]);
  });
  await installRuntime({
    sourceRoot,
    installRoot,
    bridgeRoot,
    independentNode: process.execPath,
    tunnelClient,
    tunnelId: "private-tunnel-id",
    runtimeApiKeyReference: `file:${credential}`,
  }, controlledInstallDependencies(fixtureRoot, runCommand));
  const privateRoot = path.join(installRoot, "private");
  const config = JSON.parse(await readFile(path.join(privateRoot, "config.json"), "utf8"));
  await write(privateRoot, "rollback.json", `${JSON.stringify({
    schemaVersion: 1,
    owner: "zotero-study-save-mcp-runtime",
    config,
  }, null, 2)}\n`, 0o600);
  const outsidePrivateRoot = path.join(fixtureRoot, "moved-private");
  await rename(privateRoot, outsidePrivateRoot);
  await symlink(outsidePrivateRoot, privateRoot);

  for (const operation of [startRuntime, statusRuntime, stopRuntime, removeRuntime, rollbackRuntime]) {
    const callsBefore = calls.length;
    await assert.rejects(
      operation({ installRoot }, { runCommand }),
      /symlink path component|non-symlink/u,
    );
    assert.equal(calls.length, callsBefore);
  }
  const launcher = path.join(installRoot, "bin", "zotero-mcp-lifecycle.mjs");
  assert.equal((await lstat(privateRoot)).isSymbolicLink(), true);
  assert.match(await readFile(launcher, "utf8"), /unsafe installed runtime path/u);
  const launched = await executeCommand(process.execPath, [
    launcher,
    "status",
    "--install-root",
    installRoot,
  ]);
  assert.equal(launched.code, 1, `${launched.stdout}\n${launched.stderr}`);
  assert.match(launched.stderr, /failed safely/u);
});
