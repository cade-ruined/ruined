import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", "fetch", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, result, result.exports, () => { throw new Error("Closures must never send requests"); });
  return result.exports;
}
const model = load("src/lib/membership/calendar-closures.ts", {
  "@/lib/communications/member-lifecycle-email-model": load("src/lib/communications/member-lifecycle-email-model.ts"),
});

test("approved closures use date-only exclusive ends for the exact remaining 2026 and 2027 dates", () => {
  assert.deepEqual(model.RUINED_CALENDAR_CLOSURES.map(({ startDate, endDateExclusive }) => [startDate, endDateExclusive]), [
    ["2026-11-26", "2026-11-28"], ["2026-12-23", "2026-12-28"], ["2026-12-31", "2027-01-02"],
    ["2027-05-31", "2027-06-01"], ["2027-07-04", "2027-07-05"], ["2027-09-06", "2027-09-07"],
    ["2027-11-25", "2027-11-27"], ["2027-12-23", "2027-12-28"], ["2027-12-31", "2028-01-02"],
  ]);
  assert.equal(model.RUINED_CALENDAR_CLOSURES.reduce((days, closure) => days + (Date.parse(closure.endDateExclusive) - Date.parse(closure.startDate)) / 86_400_000, 0), 21);
  for (const closure of model.RUINED_CALENDAR_CLOSURES) {
    assert.equal(closure.allDay, true);
    assert.equal(closure.timeZone, "America/Denver");
    assert.deepEqual(Object.keys(closure).sort(), ["allDay", "endDateExclusive", "id", "startDate", "timeZone", "title"]);
  }
});

test("month overlap includes New Year's Day without adding unapproved observed holidays or future years", () => {
  assert.equal(model.closuresInDateRange("2027-01-01", "2027-02-01")[0].startDate, "2026-12-31");
  assert.equal(model.closuresInDateRange("2028-01-01", "2028-02-01")[0].startDate, "2027-12-31");
  for (const [start, end] of [["2027-07-05", "2027-07-06"], ["2026-12-28", "2026-12-31"], ["2028-01-02", "2029-01-01"]]) {
    assert.deepEqual(model.closuresInDateRange(start, end), []);
  }
});

test("operations shows the selected year's closure dates with no booking, meeting or invitation controls", () => {
  const Component = load("src/components/platform/OperatorClosedDates.tsx", {
    react: { ...React, useState: () => [2027, () => {}] },
    "@/lib/membership/calendar-closures": model,
    "@/components/platform/operatorStyles": { OPERATOR_FIELD_CLASS: "operator-field" },
  }).default;
  const html = renderToStaticMarkup(React.createElement(Component));
  assert.match(html, /Closed dates/);
  assert.match(html, /May 31, 2027/);
  assert.match(html, /November 25, 2027/);
  assert.match(html, /January 1, 2028/);
  assert.match(html, /Closed · All day/);
  assert.doesNotMatch(html, /<a |<button|<form|Google Meet|Register|Reserve|Send invitations/);
});
