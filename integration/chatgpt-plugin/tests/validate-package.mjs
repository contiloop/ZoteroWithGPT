#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(testDirectory, "..");
const TARGET_PLUGIN_VERSION = "0.2.0";

const REQUIRED_SCENARIOS = [
  "direct-save",
  "indirect-save",
  "abstract-dot-pdf-normalization",
  "question-only",
  "missing-setup-or-tools",
  "unsupported-new-import-url",
  "missing-conversation-material",
  "clear-import-and-save",
  "version-ambiguity",
  "verified-duplicate-reuse",
  "unknown-outcome-same-identity",
  "manual-edit-conflict",
  "long-proof",
  "reference-urls-without-import",
  "viewer-failure-after-save",
];

const MUTATIONS = new Set([
  "ensure_arxiv_pdf",
  "create_annotation",
  "update_annotation",
  "create_note",
  "update_note",
]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readText(relativePath) {
  return readFile(path.join(pluginRoot, ...relativePath.split("/")), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed);
  return trimmed;
}

function parseSimpleYaml(source, label) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    if (rawLine.trim().length === 0 || rawLine.trimStart().startsWith("#")) continue;
    const match = rawLine.match(/^( *)([A-Za-z_][A-Za-z0-9_]*):(?: +(.*))?$/u);
    assert.notEqual(match, null, `${label}:${index + 1} is outside the supported mapping-only YAML subset`);
    const indent = match[1].length;
    assert.equal(indent % 2, 0, `${label}:${index + 1} must use two-space indentation`);
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).value;
    const key = match[2];
    assert.equal(Object.hasOwn(parent, key), false, `${label}:${index + 1} repeats ${key}`);
    const hasValue = match[3] !== undefined;
    parent[key] = hasValue ? parseScalar(match[3]) : {};
    if (!hasValue) stack.push({ indent, value: parent[key] });
  }
  return root;
}

function parseSkill(source) {
  assert.ok(source.startsWith("---\n"), "SKILL.md must start with YAML frontmatter");
  const end = source.indexOf("\n---\n", 4);
  assert.ok(end > 4, "SKILL.md must close YAML frontmatter");
  return {
    frontmatter: parseSimpleYaml(source.slice(4, end), "SKILL.md frontmatter"),
    body: source.slice(end + 5),
  };
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listFiles(directory, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`unsupported filesystem entry ${relative}`);
  }
  return files.sort();
}

function validateManifest(manifest) {
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.match(manifest.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u);
  assert.equal(manifest.name, "zotero-study-save");
  assert.match(manifest.version, /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u);
  assert.equal(manifest.version, TARGET_PLUGIN_VERSION);
  assert.ok(typeof manifest.description === "string" && manifest.description.trim().length > 0);
  assert.deepEqual(Object.keys(manifest.author).sort(), ["name"]);
  assert.equal(manifest.author.name, "Zotero AI Research Companion Project");
  for (const forbidden of ["apps", "interface", "mcpServers", "skills"]) {
    assert.equal(Object.hasOwn(manifest, forbidden), false, `portable manifest must not use top-level ${forbidden}`);
  }
  const openai = manifest.extensions?.["com.openai"];
  assert.ok(plainObject(openai));
  assert.equal(openai.apps, "./.app.json");
  const ui = openai.interface;
  assert.ok(plainObject(ui));
  assert.equal(ui.displayName, "Zotero Study Save");
  assert.ok(ui.shortDescription.length > 0 && ui.shortDescription.length <= 30);
  assert.equal(ui.category, "Productivity");
  assert.ok(Array.isArray(ui.capabilities));
  assert.deepEqual(ui.capabilities, []);
}

function validateScenarios(document) {
  assert.equal(document.schemaVersion, 1);
  assert.match(document.evidenceBoundary, /not evidence/u);
  assert.ok(Array.isArray(document.scenarios));
  const byId = new Map(document.scenarios.map((scenario) => [scenario.id, scenario]));
  assert.deepEqual([...byId.keys()].sort(), [...REQUIRED_SCENARIOS].sort());
  for (const scenario of document.scenarios) {
    assert.ok(plainObject(scenario.input));
    assert.ok(plainObject(scenario.expected));
    assert.ok(Array.isArray(scenario.expected.writes));
    for (const operation of scenario.expected.writes) {
      assert.ok(MUTATIONS.has(operation), `${scenario.id} names unsupported mutation ${operation}`);
    }
  }

  assert.deepEqual(byId.get("question-only").expected.writes, []);
  assert.equal(byId.get("direct-save").expected.explicitMentionRequired, false);
  assert.equal(byId.get("direct-save").expected.separateImportApproval, false);
  assert.equal(byId.get("indirect-save").expected.normalizedSource, "canonical_https_arxiv_version");
  assert.deepEqual(byId.get("abstract-dot-pdf-normalization").expected, {
    activation: "activate",
    clarification: "none",
    writes: ["ensure_arxiv_pdf", "create_annotation"],
    recognizedPath: "abs",
    terminalDotPdf: true,
    normalizedSource: "canonical_https_arxiv_version",
  });
  assert.equal(byId.get("missing-setup-or-tools").expected.repeatFullTutorial, false);
  assert.deepEqual(byId.get("unsupported-new-import-url").expected.writes, []);
  assert.equal(byId.get("missing-conversation-material").expected.inventContent, false);
  assert.equal(byId.get("clear-import-and-save").expected.libraryDestination, "personal_library_root");
  assert.equal(byId.get("version-ambiguity").expected.silentLatest, false);
  assert.equal(byId.get("verified-duplicate-reuse").expected.createDuplicate, false);
  assert.deepEqual(byId.get("unknown-outcome-same-identity").expected.recovery, {
    operationId: "same",
    payload: "byte_equivalent",
    newWrite: false,
  });
  assert.equal(byId.get("manual-edit-conflict").expected.writeBeforeRenewedApproval, false);
  assert.deepEqual(byId.get("long-proof").expected, {
    activation: "activate",
    writes: ["create_annotation"],
    destination: "native_annotation_comment",
    completeness: "full",
    truncate: false,
    createChildNote: false,
  });
  assert.equal(byId.get("reference-urls-without-import").expected.importReferencedWorks, false);
  assert.equal(byId.get("viewer-failure-after-save").expected.retryWrite, false);
}

const [manifest, appBinding, config, skillSource, agentSource, workflow, readme, scenarios] =
  await Promise.all([
    readJson("plugin.json"),
    readJson(".app.json"),
    readJson("skills/zotero-study-save/resources/personal-config.json"),
    readText("skills/zotero-study-save/SKILL.md"),
    readText("skills/zotero-study-save/agents/openai.yaml"),
    readText("skills/zotero-study-save/resources/workflow.md"),
    readText("README.md"),
    readJson("tests/scenarios.json"),
  ]);

validateManifest(manifest);
assert.deepEqual(appBinding, {
  apps: {
    "mac-safe-files": { id: "asdk_app_REDACTED_1" },
  },
});
assert.deepEqual(config, { bridgeRoot: null });

const skillStats = await stat(path.join(pluginRoot, "skills/zotero-study-save/SKILL.md"));
assert.ok(skillStats.size <= 1024 * 1024);
const skill = parseSkill(skillSource);
assert.equal(skill.frontmatter.name, "zotero-study-save");
assert.match(skill.frontmatter.description, /save/u);
assert.match(skill.body, /resources\/personal-config\.json/u);
assert.match(skill.body, /resources\/workflow\.md/u);

const agent = parseSimpleYaml(agentSource, "agents/openai.yaml");
assert.equal(agent.interface.display_name, "Zotero Study Save");
assert.ok(agent.interface.short_description.length <= 30);
assert.ok(agent.interface.default_prompt.length > 0);
assert.deepEqual(agent.policy, { allow_implicit_invocation: true });

for (const operation of [
  "connection_status",
  "inspect_arxiv",
  "ensure_arxiv_pdf",
  "search_papers",
  "read_pdf",
  "list_annotations",
  "list_notes",
  "read_note",
  "resolve_anchor",
  "create_annotation",
  "update_annotation",
  "create_note",
  "update_note",
  "verify_annotation",
]) {
  assert.ok(workflow.includes(`\`${operation}\``), `workflow must cover ${operation}`);
}
for (const required of [
  "descriptor → status → descriptor",
  "create-only",
  "byte-equivalent",
  "personal library root",
  "storage",
  "viewer",
  "Mac Safe Files",
]) {
  assert.ok(workflow.includes(required), `workflow omits ${required}`);
}
for (const required of [
  "one-time setup",
  "normal save request",
  "Update",
  "Remove",
  "does not remove Mac Safe Files",
  "does not delete native Zotero records",
  "client-v1/protocol/v1-request.schema.json",
]) {
  assert.ok(readme.includes(required), `README omits ${required}`);
}

validateScenarios(scenarios);

assert.equal(await readFile(path.join(pluginRoot, ".app.json"), "utf8").then((value) => value.endsWith("\n")), true);
const packageFiles = (await listFiles(pluginRoot)).filter(
  (filename) => !filename.startsWith("tests/") && filename !== "AGENTS.md",
);
assert.equal(packageFiles.includes("mcp.json"), false, "this plugin must not invent a new server");
for (const filename of packageFiles) {
  const content = await readText(filename);
  assert.doesNotMatch(content, /(?:\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\|\.dryforge(?:\/|\\))/u, `${filename} contains a private path`);
  assert.doesNotMatch(content, /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,})/u, `${filename} appears to contain a secret`);
}

process.stdout.write(`Validated Zotero Study Save source (${packageFiles.length} package files, ${scenarios.scenarios.length} expected scenarios)\n`);
