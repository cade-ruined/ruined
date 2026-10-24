import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";
import { MEMBERSHIP_ENTRY_STAGES } from "../src/lib/membership/entry-stage.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/membership/MembershipEntryProgress.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => name === "@/lib/membership/entry-stage"
  ? { MEMBERSHIP_ENTRY_STAGES }
  : require(name), mod, mod.exports);
const { MembershipEntryProgress, MembershipEntryProgressProvider } = mod.exports;
const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");

function progress(stage, complimentary = false) {
  return nodes(parseFragment(renderToStaticMarkup(React.createElement(MembershipEntryProgressProvider,
    { initialStage: stage }, React.createElement(MembershipEntryProgress, { complimentary })))));
}

test("paid registration combines agreement and payment into one visible Review & pay stage", () => {
  for (const stage of ["agreement", "payment"]) {
    const items = progress(stage).filter((node) => node.tagName === "li");
    assert.deepEqual(items.map(text), ["Details — complete", "Review & pay — current"]);
    assert.equal(items.filter((item) => attr(item, "aria-current") === "step").length, 1);
    assert.equal(attr(items[1], "aria-current"), "step");
  }
  assert.deepEqual(progress("profile").filter((node) => node.tagName === "li").map(text),
    ["Details — current", "Review & pay — not started"]);
});

test("complimentary and shared memberships never show a payment step", () => {
  for (const stage of ["profile", "agreement", "payment"]) {
    const items = progress(stage, true).filter((node) => node.tagName === "li");
    assert.equal(items.length, 2);
    assert.deepEqual(items.map(text), stage === "profile"
      ? ["Details — current", "Membership — not started"]
      : ["Details — complete", "Membership — current"]);
    assert.equal(attr(items[stage === "profile" ? 0 : 1], "aria-current"), "step");
  }
});
