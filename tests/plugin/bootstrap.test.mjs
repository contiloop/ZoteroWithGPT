import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../../addon/bootstrap.js", import.meta.url), "utf8");

test("bootstrap clears the stopped scope even when cleanup rejects", async () => {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const scope = { ResearchCompanion: { stop: async () => { throw new Error("cleanup failed"); } } };
  context.companionScope = scope;
  await assert.rejects(context.shutdown(), /cleanup failed/);
  assert.equal(context.companionScope, undefined);
});

test("an obsolete shutdown cannot clear a replacement scope", async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const context = vm.createContext({});
  vm.runInContext(source, context);
  context.companionScope = { ResearchCompanion: { stop: () => pending } };
  const stopping = context.shutdown();
  const replacement = {};
  context.companionScope = replacement;
  finish();
  await stopping;
  assert.equal(context.companionScope, replacement);
});
