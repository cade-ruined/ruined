import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(name) {
  const source = readFileSync(new URL(`../src/lib/communications/${name}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(dependency => {
    assert.ok(["./member-email-cadence-model", "./email-automation-view"].includes(dependency), `Catalog must remain pure: ${dependency}`);
    return load(dependency.slice(2));
  }, mod, mod.exports);
  return mod.exports;
}
const { COMMUNICATION_CHANNELS, COMMUNICATION_BUCKETS, buildCommunicationsCatalog: build, readCommunicationNavigation: read, writeCommunicationNavigation: write } = load("communications-catalog");

const overview = patch => ({ events: [], sequences: [], plans: [], templates: [], inactive: [], warnings: [], managedElsewhere: [],
  configuration: { enabled: true, ready: true, activatedAt: "2026-10-19T16:00:00Z" }, setupRequired: false, ...patch });
const summary = (id, patch = {}) => ({ id, title: id, kind: "foundations_01", track: "members", active: true, revision: 1,
  templateName: "Approved design", updatedAt: "2026-10-19T16:00:00Z", status: "upcoming", attention: "", timingSummary: "Call-relative",
  audienceSummary: "Verified members on the confirmed call roster with reminder permission.", inheritanceSummary: "Inherited from the sequence.",
  nextReminder: null, delivery: { sent: 0, pending: 0, failed: 0, manualReview: 0, cancelled: 0 }, ...patch });
const sequence = (id, patch) => ({ ...summary(id, patch), matchingCallCount: 1 });
const plan = (id, patch = {}) => ({ ...summary(id, patch), eventId: `call-${id}`, sequenceId: null, ...patch });
const cadence = catalog => catalog.filter(item => item.id.startsWith("cadence:"));
const workflow = (id, state = "configured") => ({ id, state, statusLabel: { configured: "Configured", paused: "Paused", incomplete: "Setup incomplete" }[state],
  title: `${id} workflow`, trigger: "Existing trigger", recipients: "Existing qualified recipients", timing: "Existing timing",
  management: { label: "Manage existing workflow", href: `/ops/${id}` }, controlBoundary: "Managed by its existing workflow." });

test("the catalog exposes the six exact buckets and three channels in their requested order", () => {
  assert.deepEqual(COMMUNICATION_BUCKETS.map(item => item.label), ["Registration", "Pre-Foundations", "Foundations", "Membership", "Missed Protocol", "Misc"]);
  assert.deepEqual(COMMUNICATION_CHANNELS.map(item => item.value), ["emails", "texts", "notifications"]);
  assert.ok(COMMUNICATION_BUCKETS.every(item => item.description.trim()));
});

test("each saved reminder stage has one home and a stage-specific preview action", () => {
  const rows = cadence(build(overview({ sequences: [sequence("f1"), sequence("f2", { kind: "foundations_02" }),
    sequence("membership", { kind: "membership" }), sequence("circle", { kind: "circle" })] })));
  assert.equal(rows.length, 10);
  const stages = id => rows.filter(item => item.action.selection.id === id).map(item => [item.action.selection.stage, item.bucket]);
  assert.deepEqual(stages("f1"), [["orientation", "pre-foundations"], ["one_week", "pre-foundations"], ["day_before", "foundations"], ["day_of", "foundations"]]);
  assert.deepEqual(stages("f2"), [["day_before", "foundations"], ["day_of", "foundations"]]);
  for (const id of ["membership", "circle"]) assert.deepEqual(stages(id), [["day_before", "membership"], ["day_of", "membership"]]);
  assert.ok(rows.every(item => item.channel === "emails" && item.action.selection.scope === "sequence"));
  assert.equal(new Set(rows.map(item => item.id)).size, rows.length);
  assert.equal(rows.find(item => item.action.selection.id === "f1" && item.action.selection.stage === "day_of").timing, "Call day · 8 a.m. MT");
  assert.equal(rows.find(item => item.action.selection.id === "f2" && item.action.selection.stage === "day_of").timing, "2½ hours before");
});

test("founder tests stay explicitly marked and their 48-hour preparation is Pre-Foundations", () => {
  const rows = cadence(build(overview({ sequences: [sequence("founder", { track: "founder_test" }), sequence("member")] })));
  const founder = rows.filter(item => item.action.selection.id === "founder");
  assert.equal(founder.length, 3);
  assert.ok(founder.every(item => item.test === true));
  assert.equal(founder.find(item => item.action.selection.stage === "two_days").bucket, "pre-foundations");
  assert.equal(founder.find(item => item.action.selection.stage === "day_of").timing, "2½ hours before");
  assert.ok(rows.filter(item => item.action.selection.id === "member").every(item => item.test === false));
});

test("inherited calls do not duplicate a shared stage while independent and missing-parent calls remain inspectable", () => {
  const rows = cadence(build(overview({ sequences: [sequence("shared")], plans: [
    plan("inherited-a", { sequenceId: "shared" }), plan("inherited-b", { sequenceId: "shared", active: false }),
    plan("custom", { title: "November call exception" }), plan("orphan", { sequenceId: "missing" }),
  ] })));
  assert.equal(rows.length, 12);
  assert.equal(rows.filter(item => item.action.selection.id.startsWith("inherited")).length, 0);
  assert.equal(rows.filter(item => item.action.selection.scope === "event").length, 8);
  assert.match(rows.find(item => item.action.selection.id === "custom").detail, /shared sequence updates and pauses do not control/);
  assert.match(rows.find(item => item.action.selection.id === "orphan").detail, /parent sequence is unavailable/);
});

test("registration welcome and profile access have separate homes but retain their actual shared configuration state", () => {
  for (const state of ["configured", "paused", "incomplete"]) {
    const rows = build(overview({ managedElsewhere: [workflow("registration", state)] })).filter(item => item.id.startsWith("workflow:"));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(item => item.bucket), ["registration", "pre-foundations"]);
    assert.ok(rows.every(item => item.status === { configured: "enabled", paused: "paused", incomplete: "attention" }[state]));
    assert.ok(rows.every(item => item.statusLabel === workflow("registration", state).statusLabel));
    assert.match(rows[0].trigger, /Registration becomes complete/);
    assert.match(rows[1].trigger, /administrator grants.*profile access/);
    assert.ok(rows.every(item => item.action.href === "/ops/registration"));
  }
  assert.equal(build(overview()).some(item => item.id.startsWith("workflow:")), false, "missing configuration is not invented as enabled");
});

test("renewal stays with Membership and the internal work digest stays in Misc", () => {
  const rows = build(overview({ managedElsewhere: [workflow("renewal"), workflow("work_digest")] })).filter(item => item.id.startsWith("workflow:"));
  assert.deepEqual(rows.map(item => [item.id, item.bucket]), [["workflow:renewal", "membership"], ["workflow:work_digest", "misc"]]);
  assert.ok(rows.every(item => item.trigger === "Existing trigger" && item.timing === "Existing timing" && item.audience === "Existing qualified recipients"));
});

test("grouping is independent of payment, profile access and Foundations lifecycle state", () => {
  const source = overview({ sequences: [sequence("foundations"), sequence("circle", { kind: "circle" })], managedElsewhere: [workflow("registration")] });
  const baseline = build(source);
  for (const lifecycle of [
    { state: "registered", completionBasis: "saved_card", profileGranted: false },
    { state: "activated", completionBasis: "complimentary", paymentConfirmed: false },
    { state: "registered", completionBasis: "paid_membership", profileGranted: false },
    { foundationsState: "in_progress", circleAssigned: true, billingState: "attention_required" },
  ]) assert.deepEqual(build({ ...source, lifecycle }), baseline);
  assert.ok(baseline.some(item => item.bucket === "foundations") && baseline.some(item => item.bucket === "membership"));
});

test("catalog status does not promise delivery when approval, global configuration or call readiness blocks it", () => {
  const cases = [
    [{ active: false }, "paused", "Paused"], [{ status: "paused" }, "paused", "Paused"],
    [{ attention: "Sequence paused. This call remains paused." }, "paused", "Paused"],
    [{ status: "blocked" }, "attention", "Needs attention"], [{ status: "changed" }, "attention", "Needs attention"],
    [{ delivery: { failed: 1 } }, "attention", "Needs attention"], [{ status: "cancelled" }, "paused", "Cancelled"],
    [{ status: "past" }, "paused", "Finished"], [{ status: "inheritance_pending" }, "attention", "Waiting for setup"],
    [{ status: "no_remaining" }, "enabled", "Waiting for a call"],
  ];
  for (const [patch, status, label] of cases) {
    const rows = cadence(build(overview({ sequences: [sequence("test", patch)] })));
    assert.ok(rows.every(item => item.status === status && item.statusLabel === label), JSON.stringify(patch));
  }
  const off = cadence(build(overview({ configuration: { enabled: false, ready: false, activatedAt: null }, sequences: [sequence("test")] })));
  assert.ok(off.every(item => item.status === "paused" && item.statusLabel === "Delivery paused"));
  const unready = cadence(build(overview({ configuration: { enabled: true, ready: false, activatedAt: null }, sequences: [sequence("test")] })));
  assert.ok(unready.every(item => item.status === "attention"));
  const finished = cadence(build(overview({ plans: [plan("done", { status: "no_remaining" })] })));
  assert.ok(finished.every(item => item.status === "paused" && item.statusLabel === "No upcoming emails"));
});

test("unfinished email workflows remain explicitly planned without activation or send actions", () => {
  const rows = build(overview());
  const missed = rows.filter(item => item.bucket === "missed-protocol");
  assert.equal(missed.length, 2);
  assert.ok(rows.every(item => item.channel === "emails" && item.status === "planned" && item.statusLabel === "Planned" && !item.action));
  assert.match(rows.find(item => item.id === "planned:email:circle-reveal").detail, /Existing Circle access and in-app notifications remain separate/);
  assert.ok(rows.some(item => item.title === "Foundations completion email" && item.bucket === "foundations"));
});

test("supplemental channels retain their facts, merge once and cannot replace a real email workflow", () => {
  const sms = { id: "sms:reminder", channel: "texts", bucket: "membership", title: "Call reminder", trigger: "Existing SMS trigger", audience: "SMS opted-in members",
    timing: "60 minutes before", status: "paused", statusLabel: "Paused", detail: "Real SMS delivery remains disabled." };
  const notification = { ...sms, id: "notification:circle-reveal", channel: "notifications", title: "Your Circle is ready", status: "enabled" };
  const source = overview({ managedElsewhere: [workflow("registration")] });
  const snapshot = structuredClone(source), extras = [sms, notification, sms, { ...sms, id: "workflow:registration-welcome", status: "enabled" },
    { ...sms, id: "invalid-channel", channel: "fax" }, { ...sms, id: "invalid-bucket", bucket: "active" }];
  const before = structuredClone(extras), rows = build(source, extras);
  assert.equal(rows.filter(item => item.id === sms.id).length, 1);
  assert.deepEqual(rows.find(item => item.id === sms.id), sms);
  assert.deepEqual(rows.find(item => item.id === notification.id), notification);
  assert.equal(rows.find(item => item.id === "workflow:registration-welcome").channel, "emails");
  assert.equal(rows.some(item => item.id.startsWith("invalid-")), false);
  assert.deepEqual(source, snapshot); assert.deepEqual(extras, before);
});

test("navigation defaults to the email bucket overview and rejects invalid URL values", () => {
  assert.deepEqual(read(""), { channel: "emails", bucket: null, view: "catalog" });
  for (const value of ["", "invalid", "__proto__", "//evil.test", "javascript:alert(1)"]) {
    assert.deepEqual(read(new URLSearchParams({ channel: value, bucket: value, commsView: value })), { channel: "emails", bucket: null, view: "catalog" });
  }
  assert.deepEqual(read("?channel=texts&bucket=pre-foundations&commsView=activity"), { channel: "texts", bucket: "pre-foundations", view: "activity" });
  assert.deepEqual(read(write("bucket=foundations", { view: "library" })), { channel: "emails", bucket: "foundations", view: "library" });
});

test("changing channels preserves the chosen bucket and the overview remains an overview", () => {
  for (const bucket of [null, ...COMMUNICATION_BUCKETS.map(item => item.value)]) {
    let search = write("mode=automations", { bucket });
    for (const channel of COMMUNICATION_CHANNELS.map(item => item.value)) {
      search = write(search, { channel });
      assert.deepEqual(read(search), { channel, bucket, view: "catalog" });
    }
  }
});

test("communication navigation composes without overwriting legacy filters, selections or view", () => {
  const original = new URLSearchParams("mode=automations&view=library&automation=sequence-1&scope=sequence&stage=day_before&q=hello&channel=texts&bucket=foundations&commsView=upcoming");
  const before = original.toString();
  const written = write(original, { channel: "emails", bucket: null, view: "catalog" });
  const params = new URLSearchParams(written);
  assert.equal(original.toString(), before);
  for (const key of ["mode", "view", "automation", "scope", "stage", "q"]) assert.equal(params.get(key), original.get(key));
  assert.equal(params.has("channel"), false); assert.equal(params.has("bucket"), false); assert.equal(params.has("commsView"), false);
  assert.deepEqual(read(write("channel=bad&bucket=bad&commsView=bad", { channel: "bad", bucket: "bad", view: "bad" })), { channel: "emails", bucket: null, view: "catalog" });
});
