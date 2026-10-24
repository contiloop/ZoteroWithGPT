#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import { configurePrivatePlugin } from "./configure-plugin-lib.mjs";

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new TypeError("options use --name value pairs");
    }
    if (Object.hasOwn(options, name)) throw new TypeError(`duplicate option ${name}`);
    options[name] = value;
  }
  const allowed = new Set([
    "--portable-plugin",
    "--account-source",
    "--app-id",
    "--output",
    "--release-version",
  ]);
  for (const name of Object.keys(options)) {
    if (!allowed.has(name)) throw new TypeError(`unknown option ${name}`);
  }
  for (const name of ["--portable-plugin", "--account-source", "--app-id", "--output"]) {
    if (options[name] === undefined) throw new TypeError(`missing required option ${name}`);
  }
  return {
    portableArchive: path.resolve(options["--portable-plugin"]),
    accountSourceDirectory: path.resolve(options["--account-source"]),
    appId: options["--app-id"],
    outputPath: path.resolve(options["--output"]),
    releaseVersion: options["--release-version"],
  };
}

export async function main(argv = process.argv.slice(2)) {
  const result = await configurePrivatePlugin(parse(argv));
  process.stdout.write(`${JSON.stringify({
    version: result.version,
    deletePaths: result.deletePaths,
  })}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch(() => {
    process.stderr.write(
      "Private plugin configuration failed safely; no account paths or identities were printed.\n",
    );
    process.exitCode = 1;
  });
}
