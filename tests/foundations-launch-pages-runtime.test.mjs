import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "@/lib/sharing") return { privateSharingMetadata: {} };
    assert.equal(name, "next/navigation", "Aliases must never read private data or mutate membership");
    return { redirect: href => { throw Error(`redirect:${href}`); } };
  }, mod, mod.exports);
  return mod.exports.default;
}

test("existing Foundations entry links lead into the independently authorized Practice page", () => {
  assert.throws(load("app/my/foundations/page.tsx"), /^Error: redirect:\/my\/practice\?area=foundations$/);
});
test("the legacy presentation URL keeps the independently gated complete deck", () => {
  assert.throws(load("app/my/foundations/experience/page.tsx"), /^Error: redirect:\/my\/foundations\/deck$/);
});
test("legacy Foundations work links use authorized Practice while explicit moment links retain owner routing", async () => {
  const overview = load("app/my/foundations/timeline/page.tsx");
  await assert.rejects(overview(), /^Error: redirect:\/my\/practice\?course=f1$/);
  await assert.rejects(overview({ searchParams: Promise.resolve({ moment: "old&moment" }) }), /^Error: redirect:\/my\/timeline\?moment=old%26moment$/);
  const partOne = load("app/my/foundations/timeline/part-1/page.tsx");
  await assert.rejects(partOne({ searchParams: Promise.resolve({ new: "1" }) }), /^Error: redirect:\/my\/practice\?course=f1$/);
  await assert.rejects(partOne({ searchParams: Promise.resolve({ moment: "old&moment" }) }), /^Error: redirect:\/my\/timeline\?moment=old%26moment$/);
});
test("old public Foundations links go through member routing", () => {
  assert.throws(load("app/foundations/page.tsx"), /^Error: redirect:\/my\/foundations$/);
});
