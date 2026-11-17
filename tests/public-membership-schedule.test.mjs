import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", js)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, result, result.exports);
  return result.exports;
}
const billing = await load("src/lib/membership/foundations-schedule.ts");
const { publicMembershipSchedule: schedule } = await load("src/lib/membership/public-schedule.ts", { "./foundations-schedule": billing });

test("November is in progress while the next open Foundations group is December", () => {
  const result = schedule("2026-11-17T19:00:00Z");
  assert.deepEqual(result.months.map(({ date, status }) => [date, status]), [["2026-11", "In progress"], ["2026-12", "Upcoming"], ["2027-01", "Upcoming"]]);
  assert.deepEqual(result.foundations, {
    cohortMonth: "2026-12",
    start: { iso: "2026-12-03T22:00:00.000Z", date: "December 3, 2026", time: "3:00 PM Mountain" },
    cutoff: { iso: "2026-12-02T22:00:00.000Z", date: "December 2, 2026", time: "3:00 PM Mountain" },
  });
});

test("roadmap rollover follows Denver midnight instead of UTC or the visitor's timezone", () => {
  const before = schedule("2026-12-01T06:59:59.999Z");
  const after = schedule("2026-12-01T07:00:00Z");
  assert.equal(before.months[0].date, "2026-11");
  assert.deepEqual(after.months.map(({ date, status }) => [date, status]), [["2026-12", "In progress"], ["2027-01", "Upcoming"]]);
  assert.deepEqual(schedule("2027-01-01T07:00:00Z").months.map(({ date, status }) => [date, status]), [["2027-01", "In progress"]]);
  assert.deepEqual(schedule("2027-02-01T07:00:00Z").months, [], "Past topics disappear without inventing unconfirmed topics");
});

test("public intake advances at the exact registration cutoff and preserves Mountain time through DST", () => {
  assert.equal(schedule("2026-12-02T21:59:59.999Z").foundations.cohortMonth, "2026-12");
  assert.equal(schedule("2026-12-02T22:00:00Z").foundations.cohortMonth, "2027-01");
  const spring = schedule("2027-03-17T12:00:00Z").foundations;
  assert.equal(spring.start.iso, "2027-04-01T21:00:00.000Z");
  assert.equal(spring.start.time, "3:00 PM Mountain");
  assert.equal(spring.cutoff.iso, "2027-03-31T21:00:00.000Z");
  assert.equal(schedule(spring.cutoff.iso).foundations.cohortMonth, "2027-05", "A cutoff in the previous month must still advance enrollment");
});

test("missing or invalid server dates never produce misleading intake dates", () => {
  assert.equal(schedule(null), null);
  assert.equal(schedule("invalid"), null);
});
