#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyXpi } from "./package-lib.mjs";

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
process.stdout.write(
  `Verified ${path.basename(archive)} (${result.members.length} files, Zotero ${result.zoteroCompatibility.minimum}–${result.zoteroCompatibility.maximum})\n`,
);
