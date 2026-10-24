import { randomBytes } from "node:crypto";

import { JSDOM } from "jsdom";

import { DomPurifyNativeNoteContentPolicy } from "../../../dist/adapters/zotero/index.js";
import { NodeFileBridgeAdapter } from "./node-file-bridge.mjs";
import { ZoteroMcpService } from "./service.mjs";

/** Composes the pure service ports with the production Node filesystem and DOM adapters. */
export function createNodeZoteroMcpService(options) {
  if (options === null || typeof options !== "object" || typeof options.bridgeRoot !== "string") {
    throw new TypeError("createNodeZoteroMcpService requires one configured bridgeRoot");
  }
  const noteDom = new JSDOM("<!doctype html><html><body></body></html>");
  try {
    return new ZoteroMcpService({
      adapter: options.adapter ?? new NodeFileBridgeAdapter({
        root: options.bridgeRoot,
        pollIntervalMs: options.pollIntervalMs,
      }),
      notePolicy: new DomPurifyNativeNoteContentPolicy({ window: noteDom.window }),
      createStatusOperationId: () => `mcp.status.${randomBytes(16).toString("hex")}`,
      waitTimeoutMs: options.waitTimeoutMs,
      close: () => noteDom.window.close(),
    });
  } catch (error) {
    noteDom.window.close();
    throw error;
  }
}
