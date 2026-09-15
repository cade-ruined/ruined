import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const elements = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);

function load(path, react = React) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/components/platform/operatorStyles") return load("src/components/platform/operatorStyles.ts", react);
    throw new Error(`Unexpected date-time field dependency ${name}`);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function fixture(changes = {}) {
  const props = { name: "startsAt", label: "Starts", required: true, ...changes };
  const states = [];
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useId: () => "field-fixture",
    useMemo: (work) => work(),
  };
  const Field = load("src/components/platform/OperatorDateTimeField.tsx", hooks).default;
  const draw = () => { cursor = 0; return Field(props); };
  const find = (predicate) => elements(draw()).find(predicate);
  return {
    draw,
    date: () => find((node) => node.type === "input" && node.props.type === "date"),
    time: () => find((node) => node.type === "select"),
    value: () => find((node) => node.type === "input" && node.props.type === "hidden" && node.props.name === props.name)?.props.value,
    clear: () => find((node) => node.type === "button" && text(node) === "Clear"),
    changeDate(value) { this.date().props.onChange({ target: { value }, currentTarget: { value } }); },
    changeTime(value) { this.time().props.onChange({ target: { value }, currentTarget: { value } }); },
  };
}

test("meeting times offer exactly 48 half-hour choices in an accessible date/time group", () => {
  const f = fixture();
  const options = elements(f.time()).filter((node) => node.type === "option");
  const available = options.filter((node) => node.props.value && !node.props.disabled);
  assert.equal(available.length, 48);
  assert.deepEqual(available.map((node) => node.props.value), Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`));
  assert.ok(options.some((node) => node.props.value === ""), "no time is selected for an empty draft");
  assert.equal(f.draw().type, "fieldset");
  assert.equal(text(elements(f.draw()).find((node) => node.type === "legend")), "Starts");
  assert.equal(f.date().props["aria-label"], "Starts date");
  assert.equal(f.time().props["aria-label"], "Starts time");
  assert.equal(f.date().props.required, true);
  assert.equal(f.time().props.required, true);
  assert.equal(f.value(), "");
});

test("a selected date and half-hour time preserve the existing wall-clock payload", () => {
  let changes = 0;
  const f = fixture({ onChange: () => { changes++; } });
  f.changeDate("2026-10-01");
  assert.equal(f.value(), "");
  f.changeTime("18:30");
  assert.equal(f.value(), "2026-10-01T18:30");
  assert.equal(changes, 2, "both controls mark their parent form dirty");
  f.changeDate("2026-10-02");
  assert.equal(f.value(), "2026-10-02T18:30", "changing a date preserves a valid half-hour choice");
});

test("an optional end stays empty but requires its missing half when partially entered", () => {
  const f = fixture({ name: "endsAt", label: "Ends (optional)", required: false });
  assert.equal(Boolean(f.date().props.required), false);
  assert.equal(Boolean(f.time().props.required), false);
  assert.equal(f.value(), "");
  f.changeDate("2026-10-02");
  assert.equal(f.time().props.required, true);
  assert.equal(f.value(), "");
  f.changeDate("");
  f.changeTime("00:30");
  assert.equal(f.date().props.required, true);
  assert.equal(f.value(), "");
  f.changeDate("2026-10-02");
  assert.equal(f.value(), "2026-10-02T00:30");
});

test("clearing an optional end clears both controls and notifies the dialog of a change", () => {
  let changes = 0;
  const f = fixture({ name: "endsAt", label: "Ends (optional)", required: false, defaultValue: "2026-10-02T00:30", onChange: () => { changes++; } });
  assert.equal(f.clear().props.type, "button", "clearing must not submit the event");
  assert.equal(f.clear().props["aria-label"], "Clear ends (optional)");
  f.clear().props.onClick();
  assert.equal(f.date().props.value, "");
  assert.equal(f.time().props.value, "");
  assert.equal(f.value(), "");
  assert.equal(Boolean(f.date().props.required), false);
  assert.equal(Boolean(f.time().props.required), false);
  assert.equal(changes, 1);
});

test("existing off-grid times remain exact until an operator intentionally reschedules", () => {
  const f = fixture({ defaultValue: "2026-09-15T11:38" });
  assert.equal(f.value(), "2026-09-15T11:38", "opening an unrelated edit must not round a saved meeting");
  const saved = elements(f.time()).find((node) => node.type === "option" && node.props.value === "11:38");
  assert.ok(saved);
  assert.equal(saved.props.disabled, true, "a legacy off-grid time cannot be picked for a new meeting");
  assert.match(text(saved), /saved/i);
  assert.equal(elements(f.time()).filter((node) => node.type === "option" && node.props.value && !node.props.disabled).length, 48);
  f.changeDate("2026-09-16");
  assert.equal(f.time().props.value, "", "changing the date requires a new half-hour selection");
  assert.equal(f.value(), "");
  f.changeTime("12:00");
  assert.equal(f.value(), "2026-09-16T12:00");
});

test("choosing a half-hour for a saved off-grid time keeps its date unchanged", () => {
  const f = fixture({ defaultValue: "2026-09-15T11:38" });
  f.changeTime("11:30");
  assert.equal(f.value(), "2026-09-15T11:30");
});

test("midnight and overnight dates still use the selected IANA zone, including DST rejection", () => {
  const { zonedDateTimeLocalToIso } = load("src/lib/datetime/zoned-date-time.ts");
  const start = fixture({ defaultValue: "2026-10-01T23:30" });
  const end = fixture({ name: "endsAt", label: "Ends", required: false, defaultValue: "2026-10-02T00:00" });
  assert.equal(end.value(), "2026-10-02T00:00");
  const from = zonedDateTimeLocalToIso(start.value(), "America/Denver");
  const until = zonedDateTimeLocalToIso(end.value(), "America/Denver");
  assert.equal(from, "2026-10-02T05:30:00.000Z");
  assert.equal(until, "2026-10-02T06:00:00.000Z");
  assert.equal(Date.parse(until) - Date.parse(from), 30 * 60 * 1000);
  assert.equal(zonedDateTimeLocalToIso(end.value(), "America/New_York"), "2026-10-02T04:00:00.000Z");
  const gap = fixture({ defaultValue: "2026-03-08T02:30" });
  assert.throws(() => zonedDateTimeLocalToIso(gap.value(), "America/Denver"), /does not exist/);
});
