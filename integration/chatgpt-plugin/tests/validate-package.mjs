import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => readFile(path.join(root, name), "utf8");
const json = async name => JSON.parse(await read(name));
const [manifest, binding, config, metadata, skill, agent, scenarios] = await Promise.all([
  json("plugin.json"), json(".app.json"),
  json("skills/zotero-study-save/resources/personal-config.json"),
  readFile(new URL("../../../package.json", import.meta.url), "utf8").then(JSON.parse),
  read("skills/zotero-study-save/SKILL.md"),
  read("skills/zotero-study-save/agents/openai.yaml"), json("tests/scenarios.json"),
]);
assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
assert.equal(manifest.name, "zotero-study-save");
assert.equal(manifest.version, metadata.version);
assert.deepEqual(Object.keys(manifest).sort(), ["$schema", "author", "description", "extensions", "name", "version"]);
assert.deepEqual(Object.keys(manifest.extensions), ["com.openai"]);
const extension = manifest.extensions["com.openai"];
assert.deepEqual(Object.keys(extension).sort(), ["apps", "interface"]);
assert.equal(extension.apps, "./.app.json");
assert.deepEqual(Object.keys(extension.interface).sort(), [
  "capabilities", "category", "defaultPrompt", "developerName", "displayName",
  "longDescription", "shortDescription",
]);
assert.deepEqual(Object.keys(manifest.author), ["name"]);
assert.equal(extension.interface.developerName, manifest.author.name);
assert.equal(extension.interface.category, "Productivity");
for (const text of [manifest.description, manifest.author.name,
  extension.interface.longDescription, extension.interface.defaultPrompt]) {
  assert.ok(typeof text === "string" && text.trim().length > 0);
}
assert.equal(extension.interface.displayName, "Zotero Study Save");
assert.ok(extension.interface.shortDescription.length <= 30);
assert.deepEqual(extension.interface.capabilities, []);
assert.deepEqual(binding, { apps: { "mac-safe-files": { id: "asdk_app_REDACTED_1" } } });
assert.deepEqual(config, { bridgeRoot: null });
assert.match(skill, /^---\nname: zotero-study-save\ndescription: [^\n]+\n---\n/u);
assert.match(agent, /allow_implicit_invocation: true/u);
assert.equal(scenarios.schemaVersion, 1);
const ids = new Set();
const reads = new Set(["connection_status", "find_local_arxiv", "search_papers", "read_pdf", "list_annotations", "list_notes", "read_note", "resolve_anchor", "verify_annotation"]);
const writes = new Set(["create_annotation", "update_annotation", "create_note", "update_note"]);
for (const scenario of scenarios.scenarios) {
  assert.equal(ids.has(scenario.id), false, `duplicate scenario ${scenario.id}`);
  ids.add(scenario.id);
  assert.ok(scenario.input && scenario.expected);
  for (const operation of scenario.expected.reads) assert.ok(reads.has(operation), operation);
  for (const operation of scenario.expected.writes) assert.ok(writes.has(operation), operation);
}
for (const id of ["selected-study-startup-read-only", "later-save-keeps-established-target", "manual-edit-conflict", "unknown-outcome-same-identity", "requested-organization", "explicit-verbatim-copy", "requested-summary"]) assert.ok(ids.has(id), id);

async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (name === "tests" || name === "AGENTS.md") continue;
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), name + "/"));
    else { assert.ok(entry.isFile(), `unsupported entry ${name}`); result.push(name); }
  }
  return result;
}
const packageFiles = await files(root);
for (const file of packageFiles) {
  const source = await read(file);
  assert.doesNotMatch(source, /(?:\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\|\.dryforge(?:\/|\\))/u, file);
  assert.doesNotMatch(source, /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,})/u, file);
}
process.stdout.write(`Validated plugin source (${packageFiles.length} files, ${ids.size} scenario specifications; no model execution)\n`);
