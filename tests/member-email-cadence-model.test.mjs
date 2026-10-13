import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(name) {
  const source = readFileSync(new URL(`../src/lib/communications/${name}.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((dependency) => {
    assert.equal(dependency, "./member-email-cadence-model");
    return load("member-email-cadence-model");
  }, compiled, compiled.exports);
  return compiled.exports;
}
const model = load("member-email-cadence-model");
const { cadenceCopy } = load("member-email-cadence-copy");
const event = { id: "call-01", title: "Foundations 01", startsAt: "2026-11-05T22:00:00.000Z", endsAt: "2026-11-05T23:30:00.000Z", timeZone: "America/Denver" };
const configuration = { enabled: true, ready: true, activatedAt: "2026-10-12T18:00:00.000Z" };
const occurrences = (override = {}, kind = "foundations_01", track = "members") => model.cadenceOccurrences({ ...event, ...override }, kind, track);
const copy = (override = {}) => cadenceCopy({ event, kind: "foundations_01", track: "members", stage: "day_before", memberName: "Jamie", siteUrl: "https://members.example.test", ...override });

test("cadence stays off without explicit enablement and a real UTC activation timestamp", () => {
  assert.deepEqual(model.getMemberEmailCadenceConfiguration({}), { enabled: false, activatedAt: null, ready: false });
  for (const value of ["", "today", "2026-10-12", "2026-02-30T18:00:00Z", "2026-10-12T25:00:00Z", "2026-10-12T18:00:00-06:00"]) {
    assert.equal(model.getMemberEmailCadenceConfiguration({ MEMBER_EMAIL_CADENCE_ENABLED: "true", MEMBER_EMAIL_CADENCE_ACTIVATED_AT: value }).ready, false, value);
  }
  assert.deepEqual(model.getMemberEmailCadenceConfiguration({ MEMBER_EMAIL_CADENCE_ENABLED: "true", MEMBER_EMAIL_CADENCE_ACTIVATED_AT: "2026-10-12T18:00:00Z" }), configuration);
  assert.equal(model.getMemberEmailCadenceConfiguration({ MEMBER_EMAIL_CADENCE_ENABLED: "1", MEMBER_EMAIL_CADENCE_ACTIVATED_AT: configuration.activatedAt }).enabled, false);
});

test("November F1 preserves local orientation and week times across the fall DST change", () => {
  assert.deepEqual(occurrences().map(({ stage, dueAt }) => [stage, dueAt]), [
    ["orientation", "2026-10-20T21:00:00.000Z"], ["one_week", "2026-10-29T21:00:00.000Z"],
    ["day_before", "2026-11-04T22:00:00.000Z"], ["day_of", "2026-11-05T15:00:00.000Z"],
  ]);
});

test("spring DST retains calendar-day offsets and the Denver eight-o’clock reminder", () => {
  assert.deepEqual(occurrences({ startsAt: "2026-03-12T21:00:00Z", endsAt: "2026-03-12T22:30:00Z" }).map(({ stage, dueAt }) => [stage, dueAt]), [
    ["orientation", "2026-02-24T22:00:00.000Z"], ["one_week", "2026-03-05T22:00:00.000Z"],
    ["day_before", "2026-03-11T21:00:00.000Z"], ["day_of", "2026-03-12T14:00:00.000Z"],
  ]);
});

test("founder F1 uses two days and 150 minutes, without member orientation or one-week stages", () => {
  assert.deepEqual(occurrences({ startsAt: "2026-10-08T21:00:00Z", endsAt: "2026-10-08T22:30:00Z" }, "foundations_01", "founder_test").map(({ stage, dueAt }) => [stage, dueAt]), [
    ["two_days", "2026-10-06T21:00:00.000Z"], ["day_before", "2026-10-07T21:00:00.000Z"], ["day_of", "2026-10-08T18:30:00.000Z"],
  ]);
});

test("all remaining call kinds use their real schedule with only the two approved reminder stages", () => {
  for (const kind of model.CADENCE_KINDS.filter(kind => kind !== "foundations_01")) {
    for (const track of model.CADENCE_TRACKS) {
      assert.deepEqual(occurrences({ startsAt: "2026-11-30T22:00:00Z", endsAt: "2026-11-30T23:30:00Z" }, kind, track).map(({ stage, dueAt }) => [stage, dueAt]), [
        ["day_before", "2026-11-29T22:00:00.000Z"], ["day_of", "2026-11-30T19:30:00.000Z"],
      ]);
    }
  }
});

test("reminder windows expire after thirty minutes and never extend into the call", () => {
  for (const occurrence of occurrences()) assert.equal(Date.parse(occurrence.expiresAt) - Date.parse(occurrence.dueAt), 30 * 60_000);
  const early = occurrences({ startsAt: "2026-11-05T15:10:00Z", endsAt: "2026-11-05T16:10:00Z" }).find(item => item.stage === "day_of");
  assert.deepEqual(early, { stage: "day_of", dueAt: "2026-11-05T15:00:00.000Z", expiresAt: "2026-11-05T15:10:00.000Z" });
  for (const startsAt of ["2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z"]) assert.equal(occurrences({ startsAt }).some(item => item.stage === "day_of"), false);
});

test("invalid events and unsupported classifications fail closed", () => {
  for (const override of [{ startsAt: "not-a-date" }, { endsAt: event.startsAt }, { endsAt: "2026-11-04T22:00:00Z" }, { timeZone: "wrong/zone" }, { title: " " }, { id: "" }]) assert.deepEqual(occurrences(override), []);
  assert.deepEqual(occurrences({}, "guess-from-title"), []);
  assert.deepEqual(occurrences({}, "membership", "everyone"), []);
});

test("dispatch observes exact window boundaries and rejects activation or enrollment backfill", () => {
  const occurrence = occurrences().find(item => item.stage === "day_before");
  const due = (now, overrides = {}) => model.cadenceOccurrenceIsDue(occurrence, { now, configuration, ...overrides });
  assert.equal(due("2026-11-04T21:59:59.999Z"), false);
  assert.equal(due(occurrence.dueAt), true);
  assert.equal(due("2026-11-04T22:29:59.999Z"), true);
  assert.equal(due(occurrence.expiresAt), false);
  assert.equal(due("2026-11-05T22:00:00Z"), false);
  assert.equal(due(occurrence.dueAt, { configuration: { ...configuration, enabled: false } }), false);
  assert.equal(due(occurrence.dueAt, { configuration: { ...configuration, ready: false } }), false);
  assert.equal(due("2026-11-04T22:10:00Z", { configuration: { ...configuration, activatedAt: "2026-11-04T22:05:00Z" } }), false);
  assert.equal(due("2026-11-04T22:10:00Z", { enrolledAt: "2026-11-04T22:05:00Z" }), false);
  assert.equal(due(occurrence.dueAt, { enrolledAt: occurrence.dueAt }), true);
  assert.equal(due("invalid"), false);
  assert.equal(due(occurrence.dueAt, { enrolledAt: "invalid" }), false);
});

test("October historical founder reminders do not become eligible when the feature is activated later", () => {
  const historical = occurrences({ startsAt: "2026-10-08T21:00:00Z", endsAt: "2026-10-08T22:30:00Z" }, "foundations_01", "founder_test");
  for (const occurrence of historical) assert.equal(model.cadenceOccurrenceIsDue(occurrence, { now: "2026-10-12T18:00:00Z", configuration }), false);
});

test("copy uses the actual event title, date, duration, named timezone and existing member routes", () => {
  const result = copy({ event: { ...event, id: "circle / 2", title: "BUILD — Cedar", startsAt: "2026-11-12T23:15:00Z", endsAt: "2026-11-13T00:00:00Z" }, kind: "circle" });
  assert.equal(result.subject, "Tomorrow: BUILD — Cedar.");
  assert.match(result.body, /Thursday, November 12, 2026/);
  assert.match(result.body, /4:15 PM MST–5:00 PM MST/);
  assert.equal(result.callUrl, "https://members.example.test/my/experiences#experience-circle%20%2F%202");
  assert.equal(result.profileUrl, "https://members.example.test/my");
  assert.equal(result.preferencesUrl, "https://members.example.test/my/account#email-reminders");
  assert.match(result.body, /Manage your email reminders in your account:/);
  assert.match(result.body, /^Jamie,/);
  assert.equal(result.body.match(/All the love,/g).length, 1);
});

test("day-of subject is Today, with Coming up when an early call’s offset is on the preceding date", () => {
  assert.equal(copy({ kind: "membership", stage: "day_of" }).subject, "Today: Foundations 01.");
  const early = { ...event, startsAt: "2026-11-05T08:00:00Z", endsAt: "2026-11-05T09:00:00Z" };
  assert.equal(copy({ event: early, kind: "circle", stage: "day_of" }).subject, "Coming up: Foundations 01.");
  const spring = { ...event, startsAt: "2026-03-09T06:30:00Z", endsAt: "2026-03-09T07:30:00Z" };
  assert.equal(copy({ event: spring, kind: "circle", stage: "day_before" }).subject, "Coming up: Foundations 01.");
});

test("copy has no unresolved placeholders, task promises, or missed/completed claims at any supported stage", () => {
  for (const kind of model.CADENCE_KINDS) for (const track of model.CADENCE_TRACKS) for (const occurrence of occurrences({}, kind, track)) {
    const result = copy({ kind, track, stage: occurrence.stage });
    assert.doesNotMatch(result.body, /\[(?:LINK|DATE|TIME|INSERT|NAME|REQUIRED)|🟡|TBD|you missed|you completed|you’ve officially completed|earned your|catch.up|recording link|deadline/i);
  }
  assert.throws(() => copy({ kind: "circle", stage: "orientation" }), /not available/);
  assert.throws(() => copy({ siteUrl: "javascript:alert(1)" }), /website URL/);
  assert.throws(() => copy({ siteUrl: "https://user:password@example.test" }), /website URL/);
});

test("recipient names and subjects cannot inject header or paragraph control characters", () => {
  const result = copy({ event: { ...event, title: "BUILD\r\nBcc: outsider@example.test" }, memberName: "Jamie\n\nInjected" });
  assert.equal(result.subject.includes("\n"), false);
  assert.match(result.body, /^Jamie Injected,/);
  assert.match(copy({ memberName: " " }).body, /^Hello,/);
});

test("maximum-length event titles produce deliverable subjects without losing the full heading or splitting Unicode", () => {
  for (const title of ["A".repeat(200), "🌱".repeat(100)]) {
    const result = copy({ event: { ...event, title } });
    assert.ok(result.subject.length <= 200);
    assert.ok(result.subject.endsWith("…"));
    assert.equal(result.heading, `Tomorrow: ${title}.`);
    assert.ok(result.body.includes(title));
    assert.equal(result.subject.isWellFormed(), true);
  }
});
