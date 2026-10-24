#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createZoteroMcpServer } from "./src/mcp-server.mjs";
import { createNodeZoteroMcpService } from "./src/node-service.mjs";

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} is outside its supported range`);
  }
  return value;
}

export async function main() {
  const bridgeRoot = process.env.ZOTERO_MCP_BRIDGE_ROOT;
  if (typeof bridgeRoot !== "string" || bridgeRoot.length === 0) {
    throw new TypeError("ZOTERO_MCP_BRIDGE_ROOT is required");
  }
  const packageValue = JSON.parse(
    await readFile(new URL("./package.json", import.meta.url), "utf8"),
  );
  const service = createNodeZoteroMcpService({
    bridgeRoot,
    waitTimeoutMs: boundedInteger(
      "ZOTERO_MCP_WAIT_TIMEOUT_MS",
      60_000,
      1,
      119_000,
    ),
    pollIntervalMs: boundedInteger(
      "ZOTERO_MCP_POLL_INTERVAL_MS",
      25,
      1,
      1_000,
    ),
  });
  const server = createZoteroMcpServer({ service, version: packageValue.version });
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 10 * 1024 * 1024,
  });
  await server.connect(transport);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch(() => {
    process.stderr.write("Zotero MCP server could not start safely.\n");
    process.exitCode = 1;
  });
}
