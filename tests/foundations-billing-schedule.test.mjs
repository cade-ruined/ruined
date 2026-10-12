import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";
async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", js)(name => { assert.ok(name in dependencies, `Unexpected runtime dependency: ${name}`); return dependencies[name]; }, result, result.exports);
  return result.exports;
}
const schedule = await load("src/lib/membership/foundations-schedule.ts");
const { createFoundationsBillingSchedule: create, foundationsBillingScheduleForMonth: forMonth, parseFoundationsBillingSchedule: parse } = schedule;
const pricing = await load("src/lib/membership/pricing.ts");
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });

test("minimum cohort is November 2026; the Thanksgiving call moves to Monday at 3pm Denver", () => {
  const result = create(new Date("2026-10-05T18:00:00Z"), "monthly");
  assert.equal(result.cohortMonth, "2026-11");
  assert.deepEqual(result.callStartsAt, ["2026-11-05T22:00:00.000Z", "2026-11-12T22:00:00.000Z", "2026-11-19T22:00:00.000Z", "2026-11-30T22:00:00.000Z"]);
  assert.equal(result.cutoffAt, "2026-11-04T22:00:00.000Z");
  assert.equal(result.serviceStartsAt, result.callStartsAt[0]);
  assert.equal(result.prepaidThrough, "2026-12-05T22:00:00.000Z");
  assert.equal(result.nextChargeAt, result.prepaidThrough);
  assert.equal(result.initialTermEndsAt, "2027-11-05T22:00:00.000Z");
});

test("exact cutoff and every later instant moves to the next month, with no skipped extra month", () => {
  assert.equal(create(new Date("2026-11-04T21:59:59.999Z"), "monthly").cohortMonth, "2026-11");
  assert.equal(create(new Date("2026-11-04T22:00:00Z"), "monthly").cohortMonth, "2026-12");
  assert.equal(create(new Date("2026-11-30T23:59:59Z"), "monthly").cohortMonth, "2026-12");
  assert.equal(create(new Date("2026-12-02T22:00:00Z"), "annual").cohortMonth, "2027-01");
});

test("four calls retain 3pm Denver across spring and fall daylight saving transitions", () => {
  assert.deepEqual(forMonth("2027-03", "monthly").callStartsAt, ["2027-03-04T22:00:00.000Z", "2027-03-11T22:00:00.000Z", "2027-03-18T21:00:00.000Z", "2027-03-25T21:00:00.000Z"]);
  assert.deepEqual(forMonth("2027-11", "monthly").callStartsAt, ["2027-11-04T21:00:00.000Z", "2027-11-11T22:00:00.000Z", "2027-11-18T22:00:00.000Z", "2027-11-25T22:00:00.000Z"]);
  assert.equal(forMonth("2027-04", "monthly").callStartsAt.length, 4, "A fifth Thursday is not part of Foundations");
});

test("every anniversary matches the existing UTC billing contract and annual prepays the whole year", () => {
  for (let year = 2026; year <= 2032; year++) for (let month = 1; month <= 12; month++) {
    const cohort = `${year}-${String(month).padStart(2, "0")}`;
    if (cohort < "2026-11") continue;
    for (const plan of ["monthly", "annual"]) {
      const result = forMonth(cohort, plan);
      assert.equal(result.nextChargeAt, policy.membershipCommitmentAnniversary(result.serviceStartsAt, plan === "monthly" ? 1 : 12));
      assert.equal(result.initialTermEndsAt, policy.membershipCommitmentAnniversary(result.serviceStartsAt, 12));
      assert.equal(Date.parse(result.serviceStartsAt) - Date.parse(result.cutoffAt), 86400000);
      const format = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "long", hour: "numeric", hour12: false });
      for (const [index, call] of result.callStartsAt.entries()) {
        const weekday = index === 3 && cohort === "2026-11" ? "Monday" : index === 3 && cohort === "2026-12" ? "Wednesday" : "Thursday";
        assert.match(format.format(new Date(call)), new RegExp(`${weekday}.*15`));
      }
      assert.deepEqual(parse(result, plan), result);
    }
  }
});

test("strict parser rejects changed, missing, additional, wrong-plan, or noncanonical schedule data", () => {
  const result = forMonth("2026-11", "monthly");
  assert.equal(parse(result, "annual"), null);
  for (const key of Object.keys(result)) {
    const missing = { ...result }; delete missing[key]; assert.equal(parse(missing, "monthly"), null, key);
    assert.equal(parse({ ...result, [key]: key === "callStartsAt" ? [...result.callStartsAt, result.callStartsAt[3]] : "invalid" }, "monthly"), null, key);
  }
  assert.equal(parse({ ...result, arbitrary: true }, "monthly"), null);
  assert.equal(parse({ ...result, serviceStartsAt: result.serviceStartsAt.replace(".000Z", "Z") }, "monthly"), null);
  assert.equal(parse({ ...result, callStartsAt: [...result.callStartsAt].reverse() }, "monthly"), null);
  assert.equal(parse(null, "monthly"), null);
  assert.throws(() => create(new Date("invalid"), "monthly"), RangeError);
  for (const cohort of ["2026-10", "2027-13", "2027-1", "2027-01junk"]) assert.throws(() => forMonth(cohort, "monthly"), RangeError);
});


test("new December quotes avoid New Year's Eve without moving billing dates", () => {
  const result = forMonth("2026-12", "monthly");
  assert.equal(result.version, "foundations-prepaid-v3");
  assert.deepEqual(result.callStartsAt, ["2026-12-03T22:00:00.000Z", "2026-12-10T22:00:00.000Z", "2026-12-17T22:00:00.000Z", "2026-12-30T22:00:00.000Z"]);
  assert.equal(result.cutoffAt, "2026-12-02T22:00:00.000Z");
  assert.equal(result.serviceStartsAt, "2026-12-03T22:00:00.000Z");
  assert.equal(result.nextChargeAt, "2027-01-03T22:00:00.000Z");
  for (const day of [24, 31]) {
    assert.equal(parse({ ...result, callStartsAt: [...result.callStartsAt.slice(0, 3), `2026-12-${day}T22:00:00.000Z`] }, "monthly"), null);
  }
});

test("accepted v1 and v2 snapshots stay exact while new v3 offers keep the same billing anchors", () => {
  for (const plan of ["monthly", "annual"]) for (const version of ["foundations-prepaid-v1", "foundations-prepaid-v2"]) {
    const finalDay = version === "foundations-prepaid-v2" ? 31 : 30;
    const accepted = {
      version, cohortMonth: "2026-12", timeZone: "America/Denver",
      callStartsAt: ["2026-12-03T22:00:00.000Z", "2026-12-10T22:00:00.000Z", "2026-12-17T22:00:00.000Z", `2026-12-${finalDay}T22:00:00.000Z`],
      cutoffAt: "2026-12-02T22:00:00.000Z", serviceStartsAt: "2026-12-03T22:00:00.000Z",
      prepaidThrough: plan === "monthly" ? "2027-01-03T22:00:00.000Z" : "2027-12-03T22:00:00.000Z",
      nextChargeAt: plan === "monthly" ? "2027-01-03T22:00:00.000Z" : "2027-12-03T22:00:00.000Z",
      initialTermEndsAt: "2027-12-03T22:00:00.000Z",
    };
    const serialized = JSON.stringify(accepted);
    assert.deepEqual(parse(accepted, plan), accepted);
    assert.deepEqual(forMonth("2026-12", plan, version), accepted);
    assert.equal(JSON.stringify(accepted), serialized, "Parsing must not mutate the accepted snapshot");
    const current = create(new Date("2026-11-15T19:00:00Z"), plan);
    assert.deepEqual(current, { ...accepted, version: "foundations-prepaid-v3", callStartsAt: [...accepted.callStartsAt.slice(0, 3), "2026-12-30T22:00:00.000Z"] });
    const wrongVersion = version === "foundations-prepaid-v2" ? "foundations-prepaid-v1" : "foundations-prepaid-v2";
    assert.equal(parse({ ...accepted, version: wrongVersion }, plan), null);
    assert.equal(parse({ ...current, version: "foundations-prepaid-v2" }, plan), null);
    assert.equal(parse({ ...accepted, version: "foundations-prepaid-v4" }, plan), null);
  }
  assert.throws(() => forMonth("2026-12", "monthly", "foundations-prepaid-v4"), /version/);
});
