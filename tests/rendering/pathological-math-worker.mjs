import { parentPort } from "node:worker_threads";

import { JSDOM } from "jsdom";

import { SafeMarkdownRenderer } from "../../dist/adapters/rendering/index.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://reader.invalid/",
});
const renderer = new SafeMarkdownRenderer({ window: dom.window });
const denseSource = "\\[".repeat((512 * 1024) / 2);
const denseResult = await renderer.render({
  content: denseSource,
  source: "annotation",
  requestedFormat: "sanitized_html",
});
const denseContainer = dom.window.document.createElement("div");
denseContainer.innerHTML = denseResult.content;

const sparseSource = `${"a".repeat(126)}\\[`.repeat(4_096);
const sparseResult = await renderer.render({
  content: sparseSource,
  source: "annotation",
  requestedFormat: "sanitized_html",
});
const sparseContainer = dom.window.document.createElement("div");
sparseContainer.innerHTML = sparseResult.content;

parentPort?.postMessage({
  denseFormat: denseResult.format,
  denseSourceLength: denseSource.length,
  denseTextMatches: denseContainer.textContent === denseSource,
  sparseSourceLength: sparseSource.length,
  sparseUsesMarkdownSemantics:
    sparseContainer.textContent?.trimEnd() === sparseSource.replaceAll("\\[", "["),
});
