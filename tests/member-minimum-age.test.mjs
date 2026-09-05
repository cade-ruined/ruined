import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/platform/config.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function minimumAge(value) {
  const module = { exports: {} };
  const env = value === undefined ? {} : { MEMBERSHIP_MINIMUM_AGE: value };
  new Function("require", "module", "exports", "process", output)((id) => {
    assert.equal(id, "server-only"); return {};
  }, module, module.exports, { env });
  return module.exports.getPlatformConfiguration().minimumAge;
}

test("membership defaults to the approved adult-only minimum", () => {
  for (const value of [undefined, "", "16", "17", "-1", "invalid", "121"]) {
    assert.equal(minimumAge(value), 18);
  }
});
test("an explicit stricter membership age remains effective", () => {
  for (const value of ["18", "21", "25", "120"]) assert.equal(minimumAge(value), Number(value));
});
