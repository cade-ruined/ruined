import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";
import * as timelineModel from "../src/components/membership/timeline-model.ts";

const require = createRequire(import.meta.url);
const component = { exports: {} };
const output = ts.transpileModule(readFileSync(new URL("../src/components/membership/RuinedTimeline.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
new Function("require", "module", "exports", output)(name => {
  if (name === "react" || name === "react/jsx-runtime") return require(name);
  if (name.endsWith("/timeline-model")) return timelineModel;
  if (name === "./timeline-persistence") return { createTimelinePersistenceAdapter: () => ({}) };
  if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  if (name.endsWith("/TimelineExportStudio")) return { __esModule: true, default: () => null };
  if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
  throw Error(`Unexpected dependency ${name}`);
}, component, component.exports);
const Timeline = component.exports.default;
const elements = node => [node, ...(node.childNodes ?? []).flatMap(elements)].filter(node => node.tagName);
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
function render(writable) {
  return elements(parseFragment(renderToStaticMarkup(React.createElement(Timeline, {
    writable, initialTimeline: { access: {}, completedAt: null, revision: "2", entries: [
      { id: "later", position: 1, year: 2020, month: null, title: "A year remembered", details: null },
      { id: "earlier", position: 2, year: 2020, month: 9, title: "A month remembered", details: null },
    ] },
  }))));
}

test("month selection is optional, labeled, and offers all months with an explicit year-only choice", () => {
  const tree = render(true), select = tree.find(n => n.tagName === "select" && attr(n, "name") === "month");
  assert.ok(select);
  assert.equal(attr(select, "required"), undefined);
  assert.equal(attr(select, "disabled"), undefined);
  assert.match(text(tree.find(n => n.tagName === "label" && attr(n, "for") === attr(select, "id"))), /MonthOptional/);
  const options = elements(select).filter(n => n.tagName === "option");
  assert.deepEqual(options.map(n => attr(n, "value")), ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))]);
  assert.equal(text(options[0]), "Year only");
  assert.equal(attr(options[0], "selected"), "");
  assert.equal(text(options[1]), "January");
  assert.equal(text(options[12]), "December");
});

test("saved months render chronologically with accessible dates; read-only members cannot change them", () => {
  const tree = render(false), dates = tree.filter(n => n.tagName === "time");
  assert.deepEqual(dates.map(text), ["Sep 2020", "2020"]);
  assert.deepEqual(dates.map(n => attr(n, "datetime")), ["2020-09", "2020"]);
  assert.deepEqual(dates.map(n => attr(n, "aria-label")), ["September 2020", "2020"]);
  assert.equal(attr(tree.find(n => n.tagName === "select"), "disabled"), "");
});
