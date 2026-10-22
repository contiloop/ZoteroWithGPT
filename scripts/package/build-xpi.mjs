#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildXpi } from "./package-lib.mjs";

function outputDirectory(args, projectRoot) {
  const index = args.indexOf("--output-dir");
  if (index < 0) return path.join(projectRoot, "artifacts");
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--output-dir requires a path");
  }
  return path.resolve(projectRoot, value);
}

const projectRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const result = await buildXpi({
  projectRoot,
  outputDirectory: outputDirectory(process.argv.slice(2), projectRoot),
});
process.stdout.write(`${result.outputPath}\n${result.clientDirectory}\n${result.pluginPath}\n`);
