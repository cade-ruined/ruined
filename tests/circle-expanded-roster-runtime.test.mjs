import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../src/components/membership/CircleMemberCluster.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "react" || name === "react/jsx-runtime") return require(name);
  if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
  if (name.endsWith("/CircleMemberPortrait")) return { __esModule: true, default: () => React.createElement("span", { "data-portrait": "" }) };
  throw new Error(`Unexpected dependency ${name}`);
}, mod, mod.exports);
const Cluster = mod.exports.default;
const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const people = (count) => Array.from({ length: count }, (_, i) => ({ id: `member-${i}`, displayName: `Person ${i + 1}`, isSelf: i === count - 1, email: null, phone: null, avatarUrl: null, bio: null, buildingNow: null, location: null }));
const render = (members) => nodes(parseFragment(renderToStaticMarkup(React.createElement(Cluster, { members }))));

test("a Circle above the target range shows every person, including a self member beyond position ten", () => {
  const tree = render(people(14));
  assert.equal(tree.filter((node) => attr(node, "data-circle-member") !== undefined).length, 14);
  const roster = tree.find((node) => attr(node, "aria-label") === "Circle members");
  assert.equal(attr(roster, "data-expanded"), "true");
  assert.equal(attr(roster, "data-member-count"), "14");
  const selected = tree.filter((node) => attr(node, "aria-pressed") === "true");
  assert.equal(selected.length, 1);
  assert.equal(attr(selected[0], "aria-label"), "View Person 14");
  assert.ok(tree.some((node) => attr(node, "href") === "/my/circle/people/member-13"));
});

test("a ten-person Circle retains its portrait arrangement and an empty Circle remains usable", () => {
  const ten = render(people(10));
  assert.equal(ten.filter((node) => attr(node, "data-circle-member") !== undefined).length, 10);
  assert.equal(attr(ten.find((node) => attr(node, "aria-label") === "Circle members"), "data-expanded"), undefined);
  const empty = render([]);
  assert.ok(empty.some((node) => attr(node, "data-circle-empty-roster") !== undefined));
  assert.equal(empty.filter((node) => node.tagName === "button").length, 0);
});
