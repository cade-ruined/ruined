import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../../src/lib/foundations/availability.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Each fixture gets the real launch guard with isolated configuration, never
// a process-wide flag that could change another test's launch state.
export function loadFoundationsAvailability(environment = {}) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)((name) => {
    assert.equal(name, "server-only");
    return {};
  }, loaded, loaded.exports, { env: environment });
  return loaded.exports;
}
