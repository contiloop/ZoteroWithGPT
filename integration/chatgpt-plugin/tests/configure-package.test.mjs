import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { configurePrivatePlugin } from "../../../scripts/package/configure-plugin-lib.mjs";

async function write(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function zipDirectory(directory, archive) {
  const files = [
    "README.md",
    "plugin.json",
    "skills/zotero/SKILL.md",
    "skills/zotero/agents/openai.yaml",
    "skills/zotero/resources/workflow.md",
  ];
  const result = spawnSync("/usr/bin/zip", ["-X", "-q", archive, "-@"], {
    cwd: directory,
    input: `${files.join("\n")}\n`,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

test("private configuration adds only a verified binding and preserves account presentation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zotero-private-plugin-"));
  const portable = path.join(root, "portable");
  const account = path.join(root, "account");
  const output = path.join(root, "private", "configured.zip");
  const portableArchive = path.join(root, "zotero-study-save-0.5.0.zip");
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));

  const sourceManifest = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "zotero-study-save",
    version: "0.5.0",
    description: "Portable source description",
    author: { name: "Zotero AI Research Companion Project" },
    extensions: { "com.openai": { interface: {
      displayName: "Zotero Study Save",
      shortDescription: "Study and save in Zotero",
      longDescription: "Study a paper already saved in Zotero.",
      developerName: "Zotero AI Research Companion Project",
      category: "Productivity",
      capabilities: [],
      defaultPrompt: "Portable prompt",
    } } },
  };
  await write(portable, "plugin.json", `${JSON.stringify(sourceManifest, null, 2)}\n`);
  await write(portable, "README.md", "UNCONFIGURED portable package.\n");
  await write(portable, "skills/zotero/SKILL.md", "---\nname: zotero\ndescription: fixture\n---\n");
  await write(portable, "skills/zotero/agents/openai.yaml", "interface:\n  display_name: Zotero Study Save\n");
  await write(portable, "skills/zotero/resources/workflow.md", "# Workflow\n");
  await zipDirectory(portable, portableArchive);

  const existingManifest = structuredClone(sourceManifest);
  existingManifest.version = "0.4.0";
  existingManifest.extensions["com.openai"] = {
    interface: {
      defaultPrompt: "Save the proof you just explained and my question to Zotero.",
      displayName: "Zotero Study Save",
      shortDescription: "Existing private summary",
      longDescription: "Existing private description",
      developerName: "Existing developer",
      category: "Productivity",
      capabilities: [],
    },
    apps: "./.app.json",
  };
  await write(account, "plugin.json", `${JSON.stringify(existingManifest, null, 2)}\n`);
  const compatibility = {
    name: "zotero-study-save",
    version: "0.4.0",
    displayName: "Preserved account identity",
    presentation: { color: "blue", order: ["study", "save"] },
  };
  await write(account, ".codex-plugin/plugin.json", `${JSON.stringify(compatibility, null, 2)}\n`);
  await write(account, ".app.json", "{}\n");
  await write(account, "skills/zotero-study-save/resources/personal-config.json", "{\"bridgeRoot\":\"/private\"}\n");
  await write(account, "skills/zotero-study-save/resources/client-v1/README.md", "obsolete\n");

  await write(account, "skills/zotero-study-save/SKILL.md", "old skill\n");
  const result = await configurePrivatePlugin({
    portableArchive,
    accountSourceDirectory: account,
    appId: "asdk_app_VerifiedPrivate123",
    outputPath: output,
  });
  assert.deepEqual(result.deletePaths, [
    "skills/zotero-study-save/SKILL.md",
    "skills/zotero-study-save/resources/client-v1/README.md",
    "skills/zotero-study-save/resources/personal-config.json",
  ]);
  assert.equal((await stat(output)).mode & 0o077, 0);

  const extracted = path.join(root, "extracted");
  const unzip = spawnSync("/usr/bin/unzip", ["-qq", output, "-d", extracted], { encoding: "utf8" });
  assert.equal(unzip.status, 0, unzip.stderr);
  const configured = JSON.parse(await readFile(path.join(extracted, "plugin.json"), "utf8"));
  assert.equal(configured.extensions["com.openai"].apps, "./.app.json");
  assert.equal(
    configured.extensions["com.openai"].interface.defaultPrompt,
    existingManifest.extensions["com.openai"].interface.defaultPrompt,
  );
  assert.equal(
    Object.keys(configured.extensions["com.openai"].interface)[0],
    "defaultPrompt",
  );
  assert.equal(
    configured.extensions["com.openai"].interface.shortDescription,
    "Existing private summary",
  );
  assert.equal(
    configured.extensions["com.openai"].interface.developerName,
    "Existing developer",
  );
  const binding = JSON.parse(await readFile(path.join(extracted, ".app.json"), "utf8"));
  assert.deepEqual(binding, {
    apps: { "zotero-mcp": { id: "asdk_app_VerifiedPrivate123" } },
  });
  const configuredCompatibility = JSON.parse(
    await readFile(path.join(extracted, ".codex-plugin", "plugin.json"), "utf8"),
  );
  assert.deepEqual(configuredCompatibility, { ...compatibility, version: "0.5.0" });
  await assert.rejects(readFile(path.join(extracted, "skills/zotero-study-save/resources/personal-config.json")));
  await assert.rejects(readFile(path.join(extracted, "skills/zotero-study-save/resources/client-v1/README.md")));

  existingManifest.version = "0.5.0";
  existingManifest.extensions["com.openai"].interface.defaultPrompt = [
    "Preserve this first account prompt.",
    "Preserve this second account prompt.",
  ];
  await write(account, "plugin.json", `${JSON.stringify(existingManifest, null, 2)}\n`);
  const arrayPromptOutput = path.join(root, "private", "configured-array-prompt.zip");
  await configurePrivatePlugin({
    portableArchive,
    accountSourceDirectory: account,
    appId: "asdk_app_VerifiedPrivate123",
    outputPath: arrayPromptOutput,
    releaseVersion: "0.5.1",
  });
  const arrayPromptExtracted = path.join(root, "array-prompt-extracted");
  const unzipArrayPrompt = spawnSync(
    "/usr/bin/unzip",
    ["-qq", arrayPromptOutput, "-d", arrayPromptExtracted],
    { encoding: "utf8" },
  );
  assert.equal(unzipArrayPrompt.status, 0, unzipArrayPrompt.stderr);
  const arrayPromptManifest = JSON.parse(
    await readFile(path.join(arrayPromptExtracted, "plugin.json"), "utf8"),
  );
  assert.deepEqual(
    arrayPromptManifest.extensions["com.openai"].interface.defaultPrompt,
    existingManifest.extensions["com.openai"].interface.defaultPrompt,
  );

  existingManifest.version = "0.5.1+account.2";
  await write(account, "plugin.json", `${JSON.stringify(existingManifest, null, 2)}\n`);
  const buildMetadataOutput = path.join(root, "private", "configured-build-metadata.zip");
  const buildMetadataResult = await configurePrivatePlugin({
    portableArchive,
    accountSourceDirectory: account,
    appId: "asdk_app_VerifiedPrivate123",
    outputPath: buildMetadataOutput,
  });
  assert.equal(buildMetadataResult.version, "0.5.1+account.2");

  compatibility.version = "0.5.2";
  await write(account, ".codex-plugin/plugin.json", `${JSON.stringify(compatibility, null, 2)}\n`);
  const higherCompatibilityResult = await configurePrivatePlugin({
    portableArchive,
    accountSourceDirectory: account,
    appId: "asdk_app_VerifiedPrivate123",
    outputPath: path.join(root, "private", "configured-higher-compatibility.zip"),
  });
  assert.equal(higherCompatibilityResult.version, "0.5.2");
});

test("private configuration rejects invented and malformed app identities", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zotero-private-plugin-invalid-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await assert.rejects(
    configurePrivatePlugin({
      portableArchive: path.join(root, "missing.zip"),
      accountSourceDirectory: root,
      appId: "placeholder-app-id",
      outputPath: path.join(root, "out.zip"),
    }),
    /verified app ID/u,
  );

  const cli = spawnSync(process.execPath, [
    path.join(
      path.resolve(new URL("../../..", import.meta.url).pathname),
      "scripts",
      "package",
      "configure-plugin.mjs",
    ),
    "--portable-plugin",
    path.join(root, "private-source-name.zip"),
    "--account-source",
    path.join(root, "private-account-source"),
    "--app-id",
    "asdk_app_VerifiedPrivate123",
    "--output",
    path.join(root, "private-output.zip"),
  ], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.equal(
    cli.stderr,
    "Private plugin configuration failed safely; no account paths or identities were printed.\n",
  );
  assert.doesNotMatch(cli.stderr, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});
