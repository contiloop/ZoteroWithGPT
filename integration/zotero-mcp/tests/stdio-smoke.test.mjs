import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { ZOTERO_MCP_TOOLS } from "../contracts.mjs";
import {
  createControlledBridgeFixture,
  defaultNativeResponse,
  startControlledNativeResponder,
} from "./helpers/controlled-bridge-fixture.mjs";

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SERVER_PATH = path.join(PACKAGE_ROOT, "server.mjs");

test("official SDK stdio initializes and exposes exact inventory, schemas, safety metadata, and concise text", async (t) => {
  const fixture = await createControlledBridgeFixture(t);
  await startControlledNativeResponder(t, fixture, async (request) =>
    defaultNativeResponse(fixture, request));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: PACKAGE_ROOT,
    env: {
      PATH: process.env.PATH,
      ZOTERO_MCP_BRIDGE_ROOT: fixture.root,
      ZOTERO_MCP_WAIT_TIMEOUT_MS: "1000",
      ZOTERO_MCP_POLL_INTERVAL_MS: "5",
    },
    stderr: "pipe",
    maxBufferSize: 10 * 1024 * 1024,
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const client = new Client({ name: "controlled-zotero-mcp-test", version: "1.0.0" });
  t.after(async () => client.close().catch(() => {}));
  await client.connect(transport);

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ZOTERO_MCP_TOOLS.map((tool) => tool.name),
  );
  for (const expected of ZOTERO_MCP_TOOLS) {
    const actual = listed.tools.find((tool) => tool.name === expected.name);
    assert.ok(actual);
    assert.deepEqual(actual.inputSchema, expected.inputSchema);
    assert.deepEqual(actual.outputSchema, expected.outputSchema);
    assert.deepEqual(actual.annotations, expected.annotations);
  }

  const result = await client.callTool({
    name: "zotero_connection_status",
    arguments: { operationId: "stdio-status-1" },
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.delivery, "published");
  assert.equal(result.structuredContent.result.state, "succeeded");
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.ok(result.content[0].text.length < 160);
  assert.doesNotMatch(result.content[0].text, /Controlled fixture|pluginVersion|capabilities/u);
  assert.equal(stderr.join(""), "");
});
