import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/platform/OperatorMemberSetup.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "react/jsx-runtime") return require(name);
  if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  throw new Error(`Setup guidance must remain presentation-only: ${name}`);
}, cjsModule, cjsModule.exports);
const Setup = cjsModule.exports.default;
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
function render({ roles = ["ops_admin"], memberId = "preview-unassigned", circle = null } = {}) {
  return parseFragment(renderToStaticMarkup(React.createElement(Setup, { record: {
    access: { roles }, header: { memberId }, community: { circle },
  } })));
}

test("administrator gets two separate, named setup paths without a submit action", () => {
  const view = render();
  const nodes = elements(view);
  assert.deepEqual(nodes.filter((node) => node.tagName === "h3").map(text), ["Circle placement", "Operator access"]);
  assert.equal(nodes.filter((node) => node.tagName === "ol").length, 2);
  assert.equal(nodes.filter((node) => node.tagName === "li").length, 6);
  assert.deepEqual(nodes.filter((node) => node.tagName === "a").map((node) => attr(node, "href")), [
    "/ops/circles?memberId=preview-unassigned#assign-member",
    "/ops/operators?memberId=preview-unassigned",
  ]);
  assert.equal(nodes.filter((node) => ["form", "input", "button"].includes(node.tagName)).length, 0);
  assert.match(text(view), /Administrator access does not require a Circle/);
  assert.match(text(view), /if asked, verifies the newest code/);
  assert.doesNotMatch(text(view), /must sign out|must verify a new code/i);
});

test("Shapers and Guides do not get administrator setup links", () => {
  for (const roles of [[], ["circle_leader"], ["guide"], ["circle_leader", "guide"]]) {
    assert.equal(elements(render({ roles })).length, 0);
  }
});

test("already placed members are not instructed to assign again", () => {
  const forming = render({ circle: { circleId: "preview-circle", name: "Circle 01", state: "forming" } });
  const active = render({ circle: { circleId: "preview-circle", name: "Circle 01", state: "active" } });
  assert.match(text(forming), /This placement is already saved/);
  assert.match(text(forming), /Review Circle activation/);
  assert.ok(elements(forming).some((node) => attr(node, "href") === "/ops/circles?memberId=preview-unassigned#activate-circle"));
  assert.match(text(active), /no need to assign this member again/);
  assert.ok(elements(active).some((node) => attr(node, "href") === "/ops/circles#circle-preview-circle"));
  assert.doesNotMatch(text(active), /Select Assign member|Activate a forming Circle/);
});

test("navigation carries only an encoded member identifier, not an email or role grant", () => {
  const view = render({ memberId: "id&email=someone@example.test#scope" });
  for (const node of elements(view).filter((node) => node.tagName === "a")) {
    const url = new URL(attr(node, "href"), "http://localhost");
    assert.deepEqual([...url.searchParams.keys()], ["memberId"]);
    assert.equal(url.searchParams.get("memberId"), "id&email=someone@example.test#scope");
    assert.equal(url.origin, "http://localhost");
  }
});
