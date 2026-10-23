import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { TextDecoder, TextEncoder } from "node:util";

import { buildDiagnosticXpi } from "./build.mjs";

const execute = promisify(execFile);
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, "../../..");

test("controlled native fault XPI is typed, deterministic, and narrowly packaged", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "r12-native-fault-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));

  const tsc = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");
  const typed = await execute(process.execPath, [
    tsc,
    "--project",
    path.join(sourceDirectory, "tsconfig.json"),
    "--pretty",
    "false",
  ], { cwd: projectRoot });
  assert.equal(typed.stderr, "");

  const first = await buildDiagnosticXpi({ outputDirectory: path.join(temporary, "first") });
  const second = await buildDiagnosticXpi({ outputDirectory: path.join(temporary, "second") });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.bundleSha256, second.bundleSha256);
  assert.deepEqual(first.members, [
    "BUILD_METADATA.json",
    "README.md",
    "bootstrap.js",
    "diagnostic.js",
    "manifest.json",
  ]);

  const listed = await execute("/usr/bin/unzip", ["-Z1", first.outputPath], { cwd: projectRoot });
  assert.deepEqual(listed.stdout.trim().split("\n"), first.members);
  const manifestText = (await execute("/usr/bin/unzip", ["-p", first.outputPath, "manifest.json"]))
    .stdout;
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.applications.zotero.id, "r12-native-fault-acceptance@zoterowithgpt.local");
  assert.equal(manifest.applications.zotero.strict_min_version, "10.0.6");
  assert.equal(manifest.applications.zotero.strict_max_version, "10.0.*");
  assert.match(manifest.applications.zotero.update_url, /^https:\/\/updates\.invalid\//u);

  const bundle = (await execute("/usr/bin/unzip", ["-p", first.outputPath, "diagnostic.js"], {
    maxBuffer: 8 * 1024 * 1024,
  })).stdout;
  for (const required of [
    "0001.99999",
    "0001.99998",
    "r12-native-fault-parent-item-only-v1",
    "r12-native-fault-disable-during-await-v1",
    "synthetic_fixture_not_network_verified",
  ]) assert.ok(bundle.includes(required), `missing fixed diagnostic identity ${required}`);
  for (const forbidden of [
    /\/Users\/[^/\s]+\//u,
    /\.dryforge(?:\/|\\)/u,
    /(?:^|[^A-Za-z])eval\s*\(/u,
    /new\s+Function\s*\(/u,
    /\bfetch\s*\(/u,
    /\bqueryAsync\s*\(/u,
  ]) assert.doesNotMatch(bundle, forbidden);

  const source = await readFile(path.join(sourceDirectory, "entry.ts"), "utf8");
  assert.equal((source.match(/operationId:\s*"r12-native-fault-/gu) ?? []).length, 2);
  assert.doesNotMatch(source, /readline|process\.stdin|prompt\s*\(/u);

  const ioCalls = [];
  const menuItems = [];
  const toolsMenu = { appendChild(item) { menuItems.push(item); } };
  const window = {
    closed: false,
    document: {
      getElementById(id) {
        if (id === "menu_ToolsPopup") return toolsMenu;
        return menuItems.find((item) => item.id === id) ?? null;
      },
      createXULElement() {
        return {
          id: "",
          setAttribute(name, value) { if (name === "id") this.id = value; },
          addEventListener() {},
          removeEventListener() {},
          remove() {},
        };
      },
    },
  };
  const sandbox = {
    Zotero: { getMainWindows: () => [window], logError(error) { throw error; } },
    IOUtils: new Proxy({}, { get(_target, property) {
      ioCalls.push(String(property));
      return async () => { throw new Error("startup must not access IOUtils"); };
    } }),
    PathUtils: new Proxy({}, { get(_target, property) {
      ioCalls.push(`PathUtils.${String(property)}`);
      return () => { throw new Error("startup must not access PathUtils"); };
    } }),
    Services: { prompt: {} },
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    structuredClone,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(bundle, sandbox, { filename: "diagnostic.js" });
  await sandbox.R12NativeFaultAcceptance.start({ id: "test", version: "1.0.0", rootURI: "" });
  assert.deepEqual(menuItems.map((item) => item.id), [
    "r12-native-fault-acceptance-parent-item-only",
    "r12-native-fault-acceptance-disable-await",
  ]);
  assert.deepEqual(ioCalls, []);
  await sandbox.R12NativeFaultAcceptance.stop();
});
