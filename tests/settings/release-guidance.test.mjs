import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MUTATION_OPERATION_NAMES,
  ARXIV_OPERATION_NAMES,
  OPERATION_NAMES,
} from "../../dist/protocol/index.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const RELEASE_VERSION = "0.4.0";

async function readText(relativePath) {
  return readFile(path.join(PROJECT_ROOT, ...relativePath.split("/")), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

test("0.4.0 release metadata and selected local-study guidance stay aligned", async () => {
  const [
    packageMetadata,
    packageLock,
    addonManifest,
    pluginManifest,
    connectionExample,
    pluginInstructions,
    agents,
    claude,
  ] = await Promise.all([
    readJson("package.json"),
    readJson("package-lock.json"),
    readJson("addon/manifest.json"),
    readJson("integration/chatgpt-plugin/plugin.json"),
    readJson("scripts/package/assets/protocol/examples/connection-status.response.json"),
    readText("integration/chatgpt-plugin/AGENTS.md"),
    readText("AGENTS.md"),
    readText("CLAUDE.md"),
  ]);

  assert.equal(packageMetadata.version, RELEASE_VERSION);
  assert.equal(packageMetadata.packageManager, "npm@11.4.2");
  assert.equal(packageMetadata.engines.node, ">=24 <27");
  assert.equal(packageLock.version, RELEASE_VERSION);
  assert.equal(packageLock.packages[""].version, RELEASE_VERSION);
  assert.equal(addonManifest.version, RELEASE_VERSION);
  assert.equal(pluginManifest.version, RELEASE_VERSION);
  assert.equal(connectionExample.data.pluginVersion, RELEASE_VERSION);
  assert.deepEqual(connectionExample.data.capabilities.operations, OPERATION_NAMES.filter(name => !ARXIV_OPERATION_NAMES.includes(name)));
  assert.equal(OPERATION_NAMES.length, 15);
  assert.equal(MUTATION_OPERATION_NAMES.length, 5);

  const interfaceMetadata = pluginManifest.extensions["com.openai"].interface;
  assert.match(interfaceMetadata.longDescription, /already saved in Zotero/iu);
  assert.match(interfaceMetadata.defaultPrompt, /arXiv/iu);
  assert.match(interfaceMetadata.defaultPrompt, /Zotero/iu);
  assert.doesNotMatch(interfaceMetadata.longDescription, /import|download/iu);


  assert.doesNotMatch(pluginInstructions, /save request authorizes.*import/iu);
  assert.equal(agents, claude);
});
