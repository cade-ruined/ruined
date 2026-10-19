import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(name) {
  const source = readFileSync(new URL(`../src/lib/communications/${name}.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", output)(dependency => {
    assert.equal(dependency, "./member-email-cadence-model");
    return load("member-email-cadence-model");
  }, mod, mod.exports);
  return mod.exports;
}
const { automationTitle, automationNeedsAttention, filterAndSortAutomations, DEFAULT_AUTOMATION_VIEW_OPTIONS } = load("email-automation-view");
const now = Date.parse("2026-10-19T16:00:00Z");
const day = 24 * 60 * 60 * 1000;
const reminder = offset => ({ dueAt: new Date(now + offset).toISOString(), expiresAt: new Date(now + offset + 30 * 60 * 1000).toISOString(), stage: "day_before", eventId: "call", eventTitle: "A call", timeZone: "America/Denver" });
const item = (id, patch = {}) => ({
  id, title: id, kind: "membership", track: "members", active: true, status: "upcoming", attention: "",
  revision: 1, updatedAt: "2026-10-18T16:00:00Z", templateName: "Personal note",
  timingSummary: "Before the call", audienceSummary: "Confirmed members of the November group", inheritanceSummary: "Current and future calls",
  nextReminder: null, delivery: { sent: 0, pending: 0, failed: 0, manualReview: 0, cancelled: 0 }, ...patch,
});
const view = (items, { query = "", status = "all", ...options } = {}) => filterAndSortAutomations(items, query, status, { ...DEFAULT_AUTOMATION_VIEW_OPTIONS, ...options }, now);
const ids = rows => rows.map(row => row.id);

test("search trims and ignores case across titles, designs, kind labels, tracks and audience descriptions", () => {
  const rows = [
    item("f", { title: "November Foundations", kind: "foundations_01", templateName: "Welcome card", audienceSummary: "Assigned November cohort" }),
    item("c", { title: "WHY", kind: "circle", track: "founder_test", templateName: "Small room", audienceSummary: "Founders Circle" }),
  ];
  for (const query of ["  NOVEMBER  ", "welcome CARD", "foundations 01", "assigned november", "members"]) assert.deepEqual(ids(view(rows, { query })), ["f"], query);
  for (const query of ["why", "small room", "circle call", "founder test", "founders circle"]) assert.deepEqual(ids(view(rows, { query })), ["c"], query);
  assert.equal(view(rows, { query: "  " }).length, 2);
  assert.equal(view(rows, { query: "unknown" }).length, 0);
  assert.equal(automationTitle(item("untitled", { title: "", kind: "circle", track: "founder_test" })), "Circle call · Founder test");
});

test("kind, track, schedule, text and effective status filters all intersect", () => {
  const rows = [
    item("chosen", { kind: "foundations_02", nextReminder: reminder(day) }),
    item("different-stage", { kind: "foundations_04", nextReminder: reminder(2 * day) }),
    item("founder", { kind: "foundations_02", track: "founder_test", nextReminder: reminder(day) }),
    item("later", { kind: "foundations_02", nextReminder: reminder(8 * day) }),
    item("paused", { kind: "foundations_02", active: false, nextReminder: reminder(day) }),
    item("different-audience", { kind: "foundations_02", audienceSummary: "December group", nextReminder: reminder(day) }),
    item("membership", { nextReminder: reminder(day) }),
  ];
  const filters = { kind: "foundations", track: "members", schedule: "week", status: "active", query: "November" };
  assert.deepEqual(ids(view(rows, filters)), ["chosen", "different-stage"]);
  assert.deepEqual(ids(view(rows, { ...filters, kind: "foundations_02" })), ["chosen"]);
  assert.deepEqual(ids(view(rows, { ...filters, track: "founder_test" })), ["founder"]);
  assert.deepEqual(ids(view(rows, { ...filters, kind: "circle" })), []);
});

test("active excludes terminal, blocked, changed, failed and inherited-paused records without treating ready future sequences as finished", () => {
  const rows = [
    item("active"), item("ready", { status: "no_remaining" }), item("inheriting", { status: "inheritance_pending" }),
    item("past", { status: "past" }), item("cancelled", { status: "cancelled" }),
    item("blocked", { status: "blocked" }), item("unavailable", { status: "unavailable" }),
    item("changed", { status: "changed" }), item("changed-text", { attention: "Call changed. Review timing." }),
    item("paused", { status: "paused" }), item("inactive", { active: false }),
    item("sequence-paused", { attention: "Sequence paused or awaiting its approved update." }),
    item("failed", { delivery: { failed: 1 } }), item("manual-review", { delivery: { manualReview: 1 } }),
  ];
  assert.deepEqual(ids(view(rows, { status: "active" })), ["active", "inheriting", "ready"]);
  assert.deepEqual(ids(view(rows, { status: "paused" })), ["inactive", "paused", "sequence-paused"]);
  assert.deepEqual(ids(view(rows, { status: "attention" })), ["blocked", "changed", "changed-text", "failed", "manual-review", "unavailable"]);
  assert.deepEqual(ids(view(rows, { status: "finished" })), ["past"]);
  assert.deepEqual(ids(view(rows, { status: "cancelled" })), ["cancelled"]);
  assert.equal(automationNeedsAttention(item("sent", { delivery: { sent: 4, pending: 2, cancelled: 1 } })), false);
});

test("next seven and thirty days are inclusive rolling windows with invalid, missing and elapsed reminders outside upcoming", () => {
  const rows = [
    item("now", { nextReminder: reminder(0) }), item("week", { nextReminder: reminder(7 * day) }),
    item("after-week", { nextReminder: reminder(7 * day + 1) }), item("month", { nextReminder: reminder(30 * day) }),
    item("later", { nextReminder: reminder(30 * day + 1) }), item("past", { nextReminder: reminder(-1) }),
    item("missing"), item("invalid", { nextReminder: { dueAt: "bad date" } }),
  ];
  assert.deepEqual(ids(view(rows, { schedule: "week" })), ["now", "week"]);
  assert.deepEqual(ids(view(rows, { schedule: "month" })), ["now", "week", "after-week", "month"]);
  assert.deepEqual(ids(view(rows, { schedule: "upcoming" })), ["now", "week", "after-week", "month", "later"]);
  assert.deepEqual(ids(view(rows, { schedule: "none" })), ["invalid", "missing", "past"]);
});

test("next reminder sorts chronologically, then names and IDs, with all unscheduled values last", () => {
  const rows = [
    item("future-z", { title: "Z", nextReminder: reminder(2 * day) }),
    item("alpha-b", { title: "Alpha", nextReminder: reminder(day) }),
    item("alpha-a", { title: "Alpha", nextReminder: reminder(day) }),
    item("past", { title: "C", nextReminder: reminder(-day) }),
    item("null", { title: "A" }), item("invalid", { title: "B", nextReminder: { dueAt: "invalid" } }),
  ];
  assert.deepEqual(ids(view(rows)), ["alpha-a", "alpha-b", "future-z", "null", "invalid", "past"]);
  assert.deepEqual(ids(view([...rows].reverse())), ids(view(rows)));
});

test("recently updated sorts newest first with invalid values last and name sort uses natural numbering", () => {
  const rows = [
    item("ten", { title: "Call 10", updatedAt: "2026-10-19T16:00:00Z" }),
    item("two", { title: "Call 2", updatedAt: "2026-10-19T16:00:00Z" }),
    item("one", { title: "Call 1", updatedAt: "2026-10-18T16:00:00Z" }),
    item("invalid", { title: "A", updatedAt: "bad date" }),
  ];
  assert.deepEqual(ids(view(rows, { sort: "updated" })), ["two", "ten", "one", "invalid"]);
  assert.deepEqual(ids(view(rows, { sort: "name" })), ["invalid", "one", "two", "ten"]);
});

test("filtering and sorting preserve source arrays, item identity and all scheduling data", () => {
  const a = Object.freeze(item("B", { nextReminder: Object.freeze(reminder(day)) }));
  const b = Object.freeze(item("A", { nextReminder: Object.freeze(reminder(0)) }));
  const rows = Object.freeze([a, b]);
  const before = JSON.stringify(rows);
  for (const sort of ["next", "updated", "name"]) {
    const result = view(rows, { sort });
    assert.notEqual(result, rows);
    assert.equal(result.find(row => row.id === a.id), a);
    assert.equal(result.find(row => row.id === b.id), b);
    assert.equal(JSON.stringify(rows), before);
  }
  assert.deepEqual(ids(rows), ["B", "A"]);
  assert.deepEqual(view([], { schedule: "none" }), []);
});
