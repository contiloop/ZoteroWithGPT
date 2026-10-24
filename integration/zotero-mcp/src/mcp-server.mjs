import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ZOTERO_MCP_TOOLS } from "../contracts.mjs";
import { renderConciseToolText } from "./core.mjs";

/** Creates the MCP protocol adapter around the replaceable Zotero service. */
export function createZoteroMcpServer(options) {
  const server = new Server(
    {
      name: "zotero-ai-research-companion-mcp",
      version: options.version,
    },
    {
      capabilities: { tools: {} },
      instructions:
        "Use only the typed Zotero tools. Mutation tools require explicit human authorization metadata and immutable operation IDs.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ZOTERO_MCP_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const wrapper = await options.service.callTool(
      request.params.name,
      request.params.arguments ?? {},
    );
    return {
      content: [{ type: "text", text: renderConciseToolText(wrapper) }],
      structuredContent: wrapper,
      ...(wrapper.error === null ? {} : { isError: true }),
    };
  });

  server.onclose = () => {
    void options.service.close?.();
  };
  return server;
}
