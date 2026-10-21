import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseProtocolRequest } from "../../dist/protocol/index.js";
import { buildXpi } from "../../scripts/package/package-lib.mjs";
import { verifyXpi } from "../../scripts/verify/package-lib.mjs";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

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
  assert.equal(
    (await directorySha256(first.clientDirectory)).digest("hex"),
    (await directorySha256(second.clientDirectory)).digest("hex"),
  );
  assert.equal(report.version, "1.2.3");
  assert.deepEqual(report.zoteroCompatibility, { minimum: "10.0.6", maximum: "10.0.*" });
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
  assert.match(
    await readFile(path.join(first.clientDirectory, "README.md"), "utf8"),
    /<BRIDGE_ROOT>\/client-v1\/README\.md/u,
  );
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
  ];
  for (const example of examples) {
    const content = await readFile(new URL(
      `../../scripts/package/assets/protocol/examples/${example}`,
      import.meta.url,
    ), "utf8");
    assert.doesNotThrow(() => parseProtocolRequest(content), example);
  }
});
