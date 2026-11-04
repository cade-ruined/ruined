import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected directory model dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
export const directoryModel = load("src/lib/platform/operator-member-directory.ts", {
  "@/lib/membership/operator-registration-progress": load("src/lib/membership/operator-registration-progress.ts"),
});
export const directoryTestDependencies = {
  "@/lib/platform/operator-member-directory": directoryModel,
  "@/components/platform/OperatorMemberDirectoryControls": load("src/components/platform/OperatorMemberDirectoryControls.tsx", {
    "@/lib/platform/operator-member-directory": directoryModel,
    "@/components/platform/operatorStyles": load("src/components/platform/operatorStyles.ts"),
  }),
};
