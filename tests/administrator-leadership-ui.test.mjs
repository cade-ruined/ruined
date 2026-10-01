import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected Leadership UI dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
const model = load("src/lib/platform/leadership-model.ts");
const { default: Manager } = load("src/components/platform/OperatorLeadershipManager.tsx", {
  "@/lib/platform/leadership-model": model,
  "@/components/platform/operatorStyles": load("src/components/platform/operatorStyles.ts"),
});
const { PREVIEW_LEADERSHIP } = load("src/lib/platform/leadership-preview.ts");
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join(" ");
const elements = node => [node, ...(node.childNodes ?? []).flatMap(elements)].filter(item => item.tagName);
const render = capabilities => parseFragment(renderToStaticMarkup(React.createElement(Manager, {
  initialDirectory: { ...PREVIEW_LEADERSHIP, grants: [], capabilities },
})));

test("an Administrator without separate grants sees all Leadership actions and no obsolete permission assignment form", () => {
  const tree = render([...model.LEADERSHIP_RESPONSIBILITIES]);
  const content = text(tree);
  for (const label of Object.values(model.LEADERSHIP_LABELS)) assert.ok(content.includes(label));
  assert.match(content, /Every active Administrator has all Leadership permissions/);
  assert.match(content, /Prepare or start a Supporter/);
  assert.match(content, /End service \/ arrange coverage/);
  assert.match(content, /Add reimbursement for review/);
  assert.match(content, /Approve reimbursement/);
  assert.doesNotMatch(content, /Not configured|Configure responsibility|Assign responsibility|Remove responsibility/);
  assert.equal(elements(tree).filter(node => node.attrs?.some(a => a.name === "name" && a.value === "capability")).length, 0);
});

test("the UI does not expose service or financial actions without effective server capabilities", () => {
  const content = text(render([]));
  assert.doesNotMatch(content, /Prepare or start a Supporter|Add reimbursement for review|Approve reimbursement/);
  assert.match(content, /Active Administrator access is required to manage readiness and coverage/);
  assert.match(content, /Active Administrator access is required to view reimbursements/);
});
