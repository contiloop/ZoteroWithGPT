import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_PROTOCOL_OPERATIONS,
  NATIVE_WRITE_OPERATIONS,
  ZOTERO_MCP_TOOLS,
} from "../../zotero-mcp/contracts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => readFile(path.join(root, name), "utf8");
const json = async name => JSON.parse(await read(name));
const [
  manifest,
  metadata,
  skill,
  workflow,
  fallbackWorkflow,
  agent,
  scenarios,
] = await Promise.all([
  json("plugin.json"),
  readFile(new URL("../../../package.json", import.meta.url), "utf8").then(JSON.parse),
  read("skills/zotero/SKILL.md"),
  read("skills/zotero/resources/workflow.md"),
  read("fallback/generic-file-workflow.md"),
  read("skills/zotero/agents/openai.yaml"),
  json("tests/scenarios.json"),
]);

assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
assert.equal(manifest.name, "zotero-study-save");
assert.equal(manifest.version, metadata.version);
assert.deepEqual(
  Object.keys(manifest).sort(),
  ["$schema", "author", "description", "extensions", "name", "version"],
);
assert.deepEqual(Object.keys(manifest.extensions), ["com.openai"]);
const extension = manifest.extensions["com.openai"];
assert.deepEqual(Object.keys(extension), ["interface"]);
assert.deepEqual(Object.keys(extension.interface).sort(), [
  "capabilities",
  "category",
  "defaultPrompt",
  "developerName",
  "displayName",
  "longDescription",
  "shortDescription",
]);
assert.deepEqual(Object.keys(manifest.author), ["name"]);
assert.equal(extension.interface.developerName, manifest.author.name);
assert.equal(extension.interface.category, "Productivity");
for (const value of [
  manifest.description,
  manifest.author.name,
  extension.interface.longDescription,
  extension.interface.defaultPrompt,
]) {
  assert.ok(typeof value === "string" && value.trim().length > 0);
}
assert.equal(extension.interface.displayName, "Zotero");
assert.ok(extension.interface.shortDescription.length <= 30);
assert.deepEqual(extension.interface.capabilities, []);

assert.match(skill, /^---\nname: zotero\ndescription: [^\n]+\n---\n/u);
assert.match(agent, /allow_implicit_invocation: true/u);
assert.equal(scenarios.schemaVersion, 2);
assert.equal(scenarios.contract, "dedicated-zotero-mcp-v1");
assert.match(scenarios.evidenceBoundary, /static workflow decision specifications/u);
assert.match(scenarios.evidenceBoundary, /not model executions/u);

const toolNames = new Set(ZOTERO_MCP_TOOLS.map(tool => tool.name));
const writeTools = new Set(NATIVE_WRITE_OPERATIONS.map(name => "zotero_" + name));
const readTools = new Set([...toolNames].filter(name => !writeTools.has(name)));
assert.deepEqual(
  [...toolNames].sort(),
  [
    ...ACTIVE_PROTOCOL_OPERATIONS.map(name => "zotero_" + name),
    "zotero_get_operation_result",
  ].sort(),
);

const ids = new Set();
for (const scenario of scenarios.scenarios) {
  assert.equal(ids.has(scenario.id), false, "duplicate scenario " + scenario.id);
  ids.add(scenario.id);
  assert.ok(
    scenario.input !== null &&
    typeof scenario.input === "object" &&
    !Array.isArray(scenario.input),
    scenario.id + " input",
  );
  assert.ok(
    scenario.expected !== null &&
    typeof scenario.expected === "object" &&
    !Array.isArray(scenario.expected),
    scenario.id + " expected",
  );
  assert.ok(
    typeof scenario.expected.activation === "string" &&
    scenario.expected.activation.length > 0,
    scenario.id + " activation",
  );
  assert.ok(Array.isArray(scenario.expected.reads), scenario.id + " reads");
  assert.ok(Array.isArray(scenario.expected.writes), scenario.id + " writes");
  for (const tool of scenario.expected.reads) {
    assert.ok(readTools.has(tool), scenario.id + " unexpected read " + tool);
  }
  for (const tool of scenario.expected.writes) {
    assert.ok(writeTools.has(tool), scenario.id + " unexpected write " + tool);
  }
  if (scenario.expected.originalWrite !== undefined) {
    assert.ok(
      writeTools.has(scenario.expected.originalWrite),
      scenario.id + " unexpected original write " + scenario.expected.originalWrite,
    );
  }
}

for (const id of [
  "selected-study-startup-read-only",
  "missing-local-item-wait-and-refresh",
  "ambiguous-local-candidates",
  "failed-switch-suspends-old-target",
  "independent-conversations-do-not-share-target",
  "long-korean-proof-question-reference-scope",
  "requested-organization",
  "explicit-verbatim-copy",
  "requested-summary",
  "stale-pdf-invalidates-anchor",
  "full-annotation-append",
  "manual-edit-conflict",
  "published-timeout-result-only-recovery",
  "missing-tool-response-result-only-recovery",
  "native-queued-bounded-result-lookup",
  "native-running-bounded-result-lookup",
  "ordinary-storage-success-finishes",
  "requested-viewer-check-failure-does-not-repeat-write",
]) {
  assert.ok(ids.has(id), id);
}

const selectedInstructions = skill + "\n" + workflow;
for (const toolName of toolNames) {
  assert.match(
    selectedInstructions,
    new RegExp("\\b" + toolName + "\\b", "u"),
    toolName,
  );
}
assert.doesNotMatch(
  selectedInstructions,
  /\b(?:fs_[a-z_]+|policy_status|inspect_arxiv|ensure_arxiv_pdf)\b/u,
  "selected workflow must not invoke generic file or acquisition tools",
);
assert.doesNotMatch(
  selectedInstructions,
  /(?:bridgeRoot|<BRIDGE_ROOT>|bridge-v1\.json|statusFile|requestDirectory|resultDirectory|requestSuffix|resultSuffix|personal-config\.json|client-v1)/u,
  "selected workflow must not expose the private file route",
);
assert.doesNotMatch(
  selectedInstructions,
  /fallback\/generic-file-workflow\.md/u,
  "selected workflow must not load source-only fallback instructions",
);
assert.match(selectedInstructions, /Studying alone never authorizes a write/u);
assert.match(selectedInstructions, /byte-equivalent complete payload unchanged/u);
assert.match(
  selectedInstructions,
  /exactly the original \x60operationId\x60 and\n\x60connection\x60/u,
);
assert.match(
  selectedInstructions,
  /exact storage later cannot\nprove semantic completeness/u,
);
assert.match(
  selectedInstructions,
  /When a native result is `queued` or `running`, make bounded/u,
);
assert.match(
  selectedInstructions,
  /Do not invent `queued` or\n`running` from a timeout/u,
);

assert.equal(
  createHash("sha256").update(fallbackWorkflow).digest("hex"),
  "4b742b37092b48296440f085b59c05064609aec0056348f650e86bade30dcdd1",
  "generic fallback must remain the exact pre-migration source workflow",
);
const resourceFiles = await readdir(
  path.join(root, "skills/zotero/resources"),
);
assert.deepEqual(resourceFiles, ["workflow.md"]);

async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (name === "tests" || name === "AGENTS.md") continue;
    if (entry.isDirectory()) {
      result.push(...await files(path.join(directory, entry.name), name + "/"));
    } else {
      assert.ok(entry.isFile(), "unsupported entry " + name);
      result.push(name);
    }
  }
  return result;
}

const sourceFiles = await files(root);
for (const file of sourceFiles) {
  const source = await read(file);
  assert.doesNotMatch(
    source,
    /(?:\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\|\.dryforge(?:\/|\\))/u,
    file,
  );
  assert.doesNotMatch(
    source,
    /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,})/u,
    file,
  );
  assert.doesNotMatch(
    source,
    /\b(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]{7,}\b/u,
    `${file} must not embed an account app id`,
  );
}

process.stdout.write(
  "Validated dedicated plugin workflow (" + sourceFiles.length +
  " source files, " + ids.size +
  " static scenario specifications; portable package unconfigured; " +
  "no model execution)\n",
);
