#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  installRuntime,
  removeRuntime,
  rollbackRuntime,
  startRuntime,
  statusRuntime,
  stopRuntime,
} from "./src/lifecycle.mjs";

function argumentsByName(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new TypeError("lifecycle options use --name value pairs");
    }
    if (Object.hasOwn(result, name.slice(2))) throw new TypeError(`duplicate option ${name}`);
    result[name.slice(2)] = value;
  }
  return result;
}

function installOptions(values) {
  const options = argumentsByName(values);
  const allowed = new Set([
    "install-root",
    "bridge-root",
    "independent-node",
    "tunnel-client",
    "tunnel-id",
    "runtime-api-key-reference",
    "control-plane-base-url",
    "control-plane-url-path",
  ]);
  for (const name of Object.keys(options)) {
    if (!allowed.has(name)) throw new TypeError(`unknown install option --${name}`);
  }
  return {
    sourceRoot: path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
    installRoot: options["install-root"],
    bridgeRoot: options["bridge-root"],
    independentNode: options["independent-node"],
    tunnelClient: options["tunnel-client"],
    tunnelId: options["tunnel-id"],
    runtimeApiKeyReference: options["runtime-api-key-reference"],
    controlPlaneBaseUrl: options["control-plane-base-url"],
    controlPlaneUrlPath: options["control-plane-url-path"],
  };
}

function rootOption(values) {
  const options = argumentsByName(values);
  if (Object.keys(options).length !== 1 || options["install-root"] === undefined) {
    throw new TypeError("command requires only --install-root <absolute-path>");
  }
  return { installRoot: options["install-root"] };
}

export async function main(argv = process.argv.slice(2)) {
  const [action, ...values] = argv;
  let result;
  switch (action) {
    case "install":
      result = await installRuntime(installOptions(values));
      break;
    case "start":
      result = await startRuntime(rootOption(values));
      break;
    case "status":
      result = await statusRuntime(rootOption(values));
      break;
    case "stop":
      result = await stopRuntime(rootOption(values));
      break;
    case "remove":
      result = await removeRuntime(rootOption(values));
      break;
    case "rollback":
      result = await rollbackRuntime(rootOption(values));
      break;
    default:
      throw new TypeError("expected install, start, status, stop, remove, or rollback");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch(() => {
    process.stderr.write(
      "Zotero MCP lifecycle failed safely; no private configuration was printed.\n",
    );
    process.exitCode = 1;
  });
}
