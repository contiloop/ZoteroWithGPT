import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseProtocolRequest } from "../../dist/protocol/index.js";
import { buildXpi } from "../../scripts/package/package-lib.mjs";
import { verifyXpi } from "../../scripts/verify/package-lib.mjs";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MANUAL_UPDATE_SENTINEL =
  "https://updates.invalid/zotero-ai-research-companion/updates.json";

async function write(root, name, content) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-companion-package-"));
  await write(root, "package.json", JSON.stringify({ name: "fixture", version: "1.2.3" }));
  await write(root, "addon/manifest.json", JSON.stringify({
    manifest_version: 2,
    name: "Research Companion Fixture",
    version: "1.2.3",
    applications: { zotero: {
      id: "research-companion@zoterowithgpt.local",
      update_url: MANUAL_UPDATE_SENTINEL,
      strict_min_version: "10.0.6",
      strict_max_version: "10.0.*",
    } },
  }));
  await write(root, "addon/bootstrap.js", [
    "async function startup({ rootURI }) {",
    "  Services.scriptloader.loadSubScript(rootURI + 'companion.js', this);",
    "  await ResearchCompanion.start();",
    "}",
    "function shutdown() { return ResearchCompanion.stop(); }",
    "function onMainWindowLoad({ window }) { ResearchCompanion.onMainWindowLoad(window); }",
    "function onMainWindowUnload({ window }) { ResearchCompanion.onMainWindowUnload(window); }",
    "function install() {}",
    "function uninstall() {}",
  ].join("\n"));
  await write(root, "src/plugin/entry.ts", [
    "export async function start(): Promise<void> {}",
    "export async function stop(): Promise<void> {}",
    "export function onMainWindowLoad(_window: unknown): void {}",
    "export function onMainWindowUnload(_window: unknown): void {}",
  ].join("\n"));
  await write(root, "THIRD_PARTY_NOTICES", "Third-party notices\n\nNo third-party runtime code in this fixture.\n");
  await write(root, "docs/install.md", "# Install\n\nChoose one dedicated directory.\n");
  await write(root, "docs/uninstall.md", "# Uninstall\n\nDisable before removal.\n");
  await write(root, "docs/troubleshooting.md", "# Troubleshooting\n\nRead the displayed status.\n");
  await write(root, "docs/protocol/v1.md", "# Protocol v1\n");
  const pluginFiles = [
    ".app.json",
    "README.md",
    "plugin.json",
    "skills/zotero-study-save/SKILL.md",
    "skills/zotero-study-save/agents/openai.yaml",
    "skills/zotero-study-save/resources/personal-config.json",
    "skills/zotero-study-save/resources/workflow.md",
  ];
  for (const member of pluginFiles) {
    const source = await readFile(path.join(PROJECT_ROOT, "integration", "chatgpt-plugin", member), "utf8");
    await write(root, `integration/chatgpt-plugin/${member}`, source);
  }
  const pluginManifestPath = path.join(root, "integration", "chatgpt-plugin", "plugin.json");
  const pluginManifest = JSON.parse(await readFile(pluginManifestPath, "utf8"));
  pluginManifest.version = "1.2.3";
  await writeFile(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`);
  return root;
}

async function sha256(filename) {
  return createHash("sha256").update(await readFile(filename)).digest("hex");
}

async function directorySha256(directory, relative = "", hash = createHash("sha256")) {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const member = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) await directorySha256(directory, member, hash);
    else {
      hash.update(member);
      hash.update("\0");
      hash.update(await readFile(path.join(directory, ...member.split("/"))));
    }
  }
  return hash;
}

test("build produces a deterministic versioned XPI with a validated release surface", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const firstDirectory = path.join(root, "first");
  const secondDirectory = path.join(root, "second");
  const inheritedEnvironmentDirectory = path.join(root, "inherited-environment");

  const first = await buildXpi({ projectRoot: root, outputDirectory: firstDirectory });
  const second = await buildXpi({ projectRoot: root, outputDirectory: secondDirectory });
  const previousZipOptions = process.env.ZIPOPT;
  let inheritedEnvironment;
  try {
    process.env.ZIPOPT = "-0";
    inheritedEnvironment = await buildXpi({
      projectRoot: root,
      outputDirectory: inheritedEnvironmentDirectory,
    });
  } finally {
    if (previousZipOptions === undefined) delete process.env.ZIPOPT;
    else process.env.ZIPOPT = previousZipOptions;
  }
  const report = await verifyXpi(first.outputPath, { expectedProjectRoot: root });

  assert.equal(path.basename(first.outputPath), "zotero-ai-research-companion-1.2.3.xpi");
  assert.equal(path.basename(first.clientDirectory), "zotero-ai-research-companion-1.2.3-client");
  assert.equal(await sha256(first.outputPath), await sha256(second.outputPath));
  assert.equal(await sha256(first.outputPath), await sha256(inheritedEnvironment.outputPath));
  assert.equal(await sha256(first.pluginPath), await sha256(second.pluginPath));
  assert.equal(await sha256(first.pluginPath), await sha256(inheritedEnvironment.pluginPath));
  assert.equal(
    (await directorySha256(first.clientDirectory)).digest("hex"),
    (await directorySha256(second.clientDirectory)).digest("hex"),
  );
  assert.equal(report.version, "1.2.3");
  assert.equal(report.members.length, 21);
  assert.equal(report.clientMembers.length, 15);
  assert.equal(report.pluginMembers.length, 22);
  assert.deepEqual(report.zoteroCompatibility, { minimum: "10.0.6", maximum: "10.0.*" });
  assert.equal(report.updateURL, MANUAL_UPDATE_SENTINEL);
  assert.equal(path.basename(report.pluginPath), "zotero-study-save-1.2.3.zip");
  assert.ok(report.members.includes("bootstrap.js"));
  assert.ok(report.members.includes("companion.js"));
  assert.ok(report.members.includes("protocol/v1-request.schema.json"));
  assert.ok(report.members.includes("protocol/v1-response.schema.json"));
  assert.ok(report.members.includes("protocol/examples/create-annotation.request.json"));
  assert.ok(report.members.includes("protocol/examples/create-annotation.response.json"));
  assert.ok(report.members.includes("THIRD_PARTY_NOTICES"));
  assert.ok(report.members.includes("prefs.js"));
  assert.ok(report.clientMembers.includes("README.md"));
  assert.ok(report.clientMembers.includes("protocol/v1-request.schema.json"));
  assert.ok(report.clientMembers.includes("protocol/examples/create-annotation.request.json"));
  assert.ok(report.clientMembers.includes("protocol/examples/find-local-arxiv.request.json"));
  assert.ok(report.clientMembers.includes("protocol/examples/find-local-arxiv.response.json"));
  assert.equal(report.clientMembers.includes("protocol/examples/inspect-arxiv.request.json"), false);
  assert.equal(report.clientMembers.includes("protocol/examples/ensure-arxiv-pdf.item-only.response.json"), false);
  assert.ok(report.pluginMembers.includes("plugin.json"));
  assert.equal(report.pluginMembers.includes(
    "skills/zotero-study-save/resources/client-v1/protocol/examples/ensure-arxiv-pdf.response.json",
  ), false);
  assert.ok(report.pluginMembers.includes(
    "skills/zotero-study-save/resources/client-v1/protocol/examples/find-local-arxiv.response.json",
  ));
  assert.match(
    await readFile(path.join(first.clientDirectory, "README.md"), "utf8"),
    /<BRIDGE_ROOT>\/client-v1\/README\.md/u,
  );
});

test("current release builds the exact 0.4.0 archive inventories", async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "research-companion-release-package-"));
  t.after(() => rm(output, { recursive: true, force: true }));

  const result = await buildXpi({ projectRoot: PROJECT_ROOT, outputDirectory: output });
  const report = await verifyXpi(result.outputPath, { expectedProjectRoot: PROJECT_ROOT });

  assert.equal(report.version, "0.4.0");
  assert.equal(report.members.length, 30);
  assert.equal(report.clientMembers.length, 15);
  assert.equal(report.pluginMembers.length, 22);
  assert.ok(report.members.includes("protocol/examples/find-local-arxiv.request.json"));
  assert.ok(report.members.includes("protocol/examples/find-local-arxiv.response.json"));
  assert.ok(report.pluginMembers.includes(
    "skills/zotero-study-save/resources/client-v1/protocol/examples/find-local-arxiv.request.json",
  ));
});

test("packaging rejects release documents containing a private source path", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, "docs/install.md", "Install from /Users/private/checkout/build.xpi\n");

  await assert.rejects(
    buildXpi({ projectRoot: root, outputDirectory: path.join(root, "out") }),
    /private or development-specific path/u,
  );
});

test("packaging rejects a manifest version that differs from the artifact version", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, "addon/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "9.9.9";
  await writeFile(manifestPath, JSON.stringify(manifest));

  await assert.rejects(
    buildXpi({ projectRoot: root, outputDirectory: path.join(root, "out") }),
    /manifest version 9\.9\.9 does not match package version 1\.2\.3/u,
  );
});

test("packaging requires the exact reserved no-service update sentinel", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, "addon/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  for (const updateUrl of [
    undefined,
    "https://example.com/updates.json",
    "data:application/json,%7B%22addons%22%3A%7B%7D%7D",
  ]) {
    if (updateUrl === undefined) delete manifest.applications.zotero.update_url;
    else manifest.applications.zotero.update_url = updateUrl;
    await writeFile(manifestPath, JSON.stringify(manifest));

    await assert.rejects(
      buildXpi({ projectRoot: root, outputDirectory: path.join(root, "out") }),
      /reserved manual-update sentinel/u,
    );
  }
});

test("package verification rejects a changed update sentinel", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await buildXpi({ projectRoot: root, outputDirectory: path.join(root, "out") });
  const extracted = path.join(root, "extracted");
  const unzip = spawnSync("/usr/bin/unzip", ["-qq", result.outputPath, "-d", extracted], {
    encoding: "utf8",
  });
  assert.equal(unzip.status, 0, unzip.stderr);
  const manifestPath = path.join(extracted, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.applications.zotero.update_url = "https://example.com/updates.json";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await rm(result.outputPath, { force: true });
  const zip = spawnSync("/usr/bin/zip", ["-X", "-q", result.outputPath, "-@"], {
    cwd: extracted,
    encoding: "utf8",
    input: `${result.members.join("\n")}\n`,
  });
  assert.equal(zip.status, 0, zip.stderr);

  await assert.rejects(
    verifyXpi(result.outputPath, { expectedProjectRoot: root }),
    /reserved manual-update sentinel/u,
  );
});

test("package verification rejects a client sidecar that drifts from the XPI", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await buildXpi({ projectRoot: root, outputDirectory: path.join(root, "out") });
  const readme = path.join(result.clientDirectory, "README.md");
  await writeFile(readme, `${await readFile(readme, "utf8")}Changed after packaging.\n`, "utf8");

  await assert.rejects(
    verifyXpi(result.outputPath, { expectedProjectRoot: root }),
    /differs from the XPI/u,
  );
});

test("bundled runtime dependencies use exact npm notice identities and include license texts", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(
    path.join(PROJECT_ROOT, "node_modules", "dompurify"),
    path.join(root, "node_modules", "dompurify"),
    { recursive: true },
  );
  await write(root, "src/plugin/entry.ts", [
    'import DOMPurify from "dompurify";',
    "export function sanitize(value: string): string { return DOMPurify.sanitize(value); }",
  ].join("\n"));
  await write(
    root,
    "THIRD_PARTY_NOTICES",
    await readFile(path.join(PROJECT_ROOT, "THIRD_PARTY_NOTICES"), "utf8"),
  );

  const result = await buildXpi({ projectRoot: root, outputDirectory: path.join(root, "out") });
  const report = await verifyXpi(result.outputPath, { expectedProjectRoot: root });

  assert.deepEqual(report.runtimePackages, [{
    name: "dompurify",
    version: "3.4.17",
    license: "(MPL-2.0 OR Apache-2.0)",
  }]);
  assert.ok(report.members.includes("third-party-licenses/dompurify/LICENSE"));
  assert.ok(report.members.includes("third-party-licenses/dompurify/LICENSE-MPL"));
});

test("every packaged request example passes the runtime protocol-v1 parser", async () => {
  const examples = [
    "connection-status.request.json",
    "read-pdf.request.json",
    "create-annotation.request.json",
    "create-note.request.json",
    "find-local-arxiv.request.json",
  ];
  for (const example of examples) {
    const content = await readFile(new URL(
      `../../scripts/package/assets/protocol/examples/${example}`,
      import.meta.url,
    ), "utf8");
    assert.doesNotThrow(() => parseProtocolRequest(content), example);
  }
});
