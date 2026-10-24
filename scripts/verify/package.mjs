#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyRelocatedServer, verifyXpi } from "./package-lib.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const archive = process.argv[2] === undefined
  ? path.join(
    projectRoot,
    "artifacts",
    `zotero-ai-research-companion-${String(packageMetadata.version)}.xpi`,
  )
  : path.resolve(projectRoot, process.argv[2]);
const result = await verifyXpi(archive, { expectedProjectRoot: projectRoot });
const smoke = await verifyRelocatedServer(result.serverPath);
if (smoke.lifecycleInstalled !== true) throw new Error("relocated lifecycle install smoke did not run");
process.stdout.write(
  `Verified ${path.basename(archive)} (${result.members.length} files), ${path.basename(result.clientDirectory)} (${result.clientMembers.length} files), ${path.basename(result.pluginPath)} (${result.pluginMembers.length} files), and relocated lifecycle-installed ${path.basename(result.serverPath)} (${result.serverMembers.length} files; SDK initialized ${smoke.tools} tools), Zotero ${result.zoteroCompatibility.minimum}–${result.zoteroCompatibility.maximum}\n`,
);
