import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(path, dependencies = {}, fetch = () => { throw Error("Unexpected network request"); }, browser = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "fetch", "window", "document", "requestAnimationFrame", "Element", output)(name => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name];
  }, mod, mod.exports, fetch, browser.window, browser.document, browser.requestAnimationFrame, browser.Element);
  return mod.exports;
}
const styles = compile("src/components/platform/operatorStyles.ts");
const samples = compile("src/components/platform/emailGroupPreview.ts");
const history = compile("src/components/platform/OperatorEmailGroupCampaigns.tsx", { "@/components/platform/operatorStyles": styles });
const nodes = node => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
function harness() {
  const slots = [], effects = [], timers = new Map(); let cursor = 0, changed = false, timerId = 0;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = { ...React,
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === "function" ? initial() : initial, set(next) { const value = typeof next === "function" ? next(slots[i].value) : next; changed ||= !Object.is(value, slots[i].value); slots[i].value = value; } }; return [slots[i].value, slots[i].set]; },
    useCallback(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { callback, deps }; return slots[i].callback; },
    useEffect(effect, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const browser = {
    window: { addEventListener() {}, removeEventListener() {}, location: { href: "https://example.test/ops/emails", pathname: "/ops/emails", search: "", assign() {} }, setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } },
    document: { addEventListener() {}, removeEventListener() {}, getElementById() { return { focus() {}, scrollIntoView() {} }; } }, requestAnimationFrame(callback) { callback(); }, Element: class Element {},
  };
  function render(Component, props) { for (let i = 0; i < 20; i++) { cursor = 0; changed = false; const tree = Component(props); effects.splice(0).forEach(effect => effect()); if (!changed) return tree; } throw Error("Unstable render"); }
  async function flushTimers(delay) { for (const [id, timer] of timers) if (timer.delay === delay) { timers.delete(id); await timer.callback(); } }
  return { hooks, browser, render, flushTimers };
}
function controls(draw) {
  const find = predicate => nodes(draw()).find(predicate);
  const button = label => { const result = find(node => node.type === "button" && text(node) === label); assert.ok(result, `Missing button: ${label}`); return result; };
  const change = (id, value) => { const field = find(node => node.props?.id === id); assert.ok(field, `Missing field: ${id}`); field.props.onChange({ target: { value }, currentTarget: { value } }); };
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return draw(); };
  const submit = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  return { draw, find, button, change, settle, submit };
}
const GROUP_API = "/api/ops/emails/groups", CAMPAIGN_API = `${GROUP_API}/campaigns`, API = "/api/ops/emails/resend";
const person = samples.SAMPLE_GROUP_PEOPLE[0], other = samples.SAMPLE_GROUP_PEOPLE[1];
function groupFixture({ preview = true, onSelect, respond, initialGroupId } = {}) {
  const h = harness(), calls = [], pending = [], dirty = [], store = samples.createEmailGroupPreview();
  const props = { groups: [...store.values()].map(item => item.group), ruleOptions: samples.SAMPLE_GROUP_OPTIONS, preview, previewStore: store, initialGroupId,
    onGroupsChange(group) { props.groups = [...props.groups.filter(item => item.id !== group.id), group]; }, onSelect, onPendingChange(value) { pending.push(value); }, onDirtyChange(value) { dirty.push(value); } };
  const Component = compile("src/components/platform/OperatorEmailGroups.tsx", { react: h.hooks, "@/components/platform/operatorStyles": styles, "@/components/platform/emailGroupPreview": samples }, async (url, options) => { const call = { url, ...options }; calls.push(call); return respond(call); }, h.browser).default;
  const draw = () => h.render(Component, props);
  return { ...controls(draw), calls, props, store, pending, dirty };
}

test("manual groups retain known people across searches and remain entirely local in preview", async () => {
  const selected = []; const f = groupFixture({ onSelect: group => selected.push(group) });
  f.button("Create group").props.onClick(); f.change("email-group-name", "The invite list");
  for (const name of ["Alex", "Jordan"]) {
    f.change("email-group-person-search", name); f.button("Find people").props.onClick(); await f.settle();
    const row = f.find(node => node.type === "li" && text(node).includes(name)); nodes(row).find(node => node.type === "input").props.onChange();
  }
  assert.match(text(f.draw()), /2 selected/);
  await f.submit(); await f.settle();
  assert.equal(selected.length, 1); assert.equal(selected[0].memberCount, 2);
  assert.deepEqual(f.store.get(selected[0].id).members.map(item => item.email), [person.email, other.email]);
  assert.equal(f.calls.length, 0); assert.equal(f.pending.at(-1), false); assert.equal(f.dirty.at(-1), false);
});

test("rule edits require a fresh preview and send exact selected source without permission changes", async () => {
  const f = groupFixture(); f.button("Create group").props.onClick(); f.change("email-group-name", "November group"); f.change("email-group-mode", "rule");
  f.change("email-group-rule", "foundations_cohort"); f.change("email-group-cohort", "2026-11");
  assert.equal(f.button("Save sample group").props.disabled, true);
  f.button("Preview matches").props.onClick(); await f.settle(); assert.match(text(f.draw()), /2 people match now/);
  assert.equal(f.button("Save sample group").props.disabled, false);
  f.change("email-group-name", "November members"); assert.equal(f.button("Save sample group").props.disabled, true);
  f.button("Preview matches").props.onClick(); await f.settle(); await f.submit(); await f.settle();
  assert.deepEqual([...f.store.values()].find(item => item.group.name === "November members").rule, { kind: "foundations_cohort", cohortMonth: "2026-11" });
  assert.match(text(f.draw()), /No real data or email permissions changed/); assert.equal(f.calls.length, 0);
});

test("group save rejects concurrent duplicate submits and sends only selected canonical contacts", async () => {
  let release; const saved = new Promise(resolve => { release = resolve; });
  const f = groupFixture({ preview: false, respond: async call => {
    if (call.method === "GET") return Response.json({ members: [person], hasMore: true });
    const body = JSON.parse(call.body); assert.equal(body.action, "save"); await saved;
    return Response.json({ group: { ...f.props.groups[0], ...body.group, id: "new-group", revision: 1, memberCount: 1 }, rule: null, members: body.group.members });
  } });
  f.button("Create group").props.onClick(); f.change("email-group-name", "One person"); f.button("Find people").props.onClick(); await f.settle();
  assert.match(text(f.draw()), /Showing the first 50 matches/);
  f.find(node => node.type === "input" && node.props.type === "checkbox").props.onChange();
  const form = f.find(node => node.type === "form"); form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1); assert.equal(f.button("Back to groups").props.disabled, true);
  release(); await f.settle();
  assert.deepEqual(JSON.parse(f.calls.find(call => call.method === "POST").body).group.members, [person]);
  assert.match(text(f.draw()), /1 person currently in this group/); assert.equal(f.pending.at(-1), false);
});

test("archiving and restoring preserve the revision guard and stale saves retain edits", async () => {
  const entry = samples.createEmailGroupPreview().get("sample-group-manual"); let revision = entry.group.revision;
  const f = groupFixture({ preview: false, initialGroupId: entry.group.id, respond: async call => {
    if (call.method === "GET") return Response.json(entry);
    const body = JSON.parse(call.body);
    if (body.action === "save") return Response.json({ error: "This group changed. Reload its latest version." }, { status: 409 });
    assert.equal(body.action, "archive"); assert.equal(body.revision, revision++);
    return Response.json({ ...entry, group: { ...entry.group, revision, archivedAt: body.archived ? "2026-10-13T15:00:00Z" : null } });
  } });
  f.draw(); await f.settle(); f.button("Archive group").props.onClick(); await f.settle(); f.button("Restore group").props.onClick(); await f.settle();
  f.button("Edit group").props.onClick(); f.change("email-group-name", "Unsaved revision"); await f.submit(); await f.settle();
  assert.match(text(f.draw()), /This group changed/); assert.equal(f.find(node => node.props?.id === "email-group-name").props.value, "Unsaved revision");
  f.button("Back to groups").props.onClick(); assert.match(text(f.draw()), /Discard the changes/);
  f.button("Keep editing").props.onClick(); assert.equal(f.find(node => node.props?.id === "email-group-name").props.value, "Unsaved revision");
});

test("unavailable rule groups remain manageable without claiming an empty or selectable audience", async () => {
  const f = groupFixture({ onSelect() {} }); const group = { ...f.props.groups[1], memberCount: null, issue: "The source call is unavailable." };
  f.props.groups = [group]; f.store.set(group.id, { group, rule: { kind: "call_audience", callEventId: "missing-call" }, members: [] });
  assert.match(text(f.draw()), /Unavailable/); assert.doesNotMatch(text(f.draw()), /null people|0 people/);
  assert.equal(f.find(node => node.type === "button" && text(node).startsWith("Use group")), undefined);
  f.find(node => node.type === "button" && text(node).startsWith("View")).props.onClick(); await f.settle();
  assert.match(text(f.draw()), /Audience currently unavailable/); assert.ok(f.button("Edit group")); assert.ok(f.button("Archive group"));
});

const template = { id: "template-1", version: "version-1", name: "Member note", status: "published", hasUnpublishedVersions: false, html: "<html><head></head><body><p>Original design</p></body></html>", text: null, subject: "A member note", from: "Ruined <hello@example.test>", replyTo: [], variables: [], fields: [{ key: "body", label: "Message", value: "Original copy" }] };
const reviewed = { id: "review-1", origin: "local_group", mode: "campaign", campaignId: "campaign-1", subject: "Approved subject", html: template.html, text: "Approved body", from: template.from, replyTo: [], recipients: [{ email: person.email, name: person.name }], recipientCount: 1, excludedCount: 1, excluded: [{ email: other.email, name: other.name, reason: "Membership reminders are off." }], groupName: "Selected members", purpose: "membership_updates", expiresAt: "2099-01-01T00:00:00Z" };
function composerFixture({ preview = false, sendingReady = true, respond } = {}) {
  const h = harness(), calls = [], sampleGroups = samples.createEmailGroupPreview(); let campaign, campaigns = [], revision = 0;
  const data = { templates: [template], segments: [{ id: "segment-1", name: "Existing Resend segment" }], topics: [{ id: "topic-1", name: "Member notices", defaultSubscription: "opt_in" }], broadcasts: [], emails: [], configuration: { connected: true, sendingReady: true, issues: [] }, cursors: { broadcasts: null, emails: null } };
  const config = { ready: true, sendingReady, issues: sendingReady ? [] : ["Group sending is paused."] };
  const deps = { react: h.hooks, "next/link": { __esModule: true, default: "a" }, "@/components/platform/OperatorPageFrame": { __esModule: true, default: "main" }, "@/components/platform/OperatorMessagesTabs": { __esModule: true, default: "message-tabs" }, "@/components/platform/operatorStyles": styles,
    "@/components/platform/OperatorDialog": { __esModule: true, default: "dialog" }, "@/components/platform/OperatorEmailGroups": { __esModule: true, default: "email-groups" }, "@/components/platform/OperatorEmailGroupCampaigns": { ...history, __esModule: true, default: "group-history" }, "@/components/platform/emailGroupPreview": samples,
    "@/components/platform/OperatorEmailBannerUpload": { __esModule: true, default: "banner-upload", renderLocalEmailBanner: html => html }, "@/components/platform/emailSignOffPreview": { renderEmailSignOffPreview: async () => undefined },
    "@/lib/communications/resend-email-templates": { normalizeResendEmailBanner: value => value ?? null, normalizeResendEmailSignOff: value => value ?? null, renderResendEmailTemplate: (selected, edits) => ({ html: selected.html, subject: edits.subject, from: selected.from }) },
  };
  async function fallback(call) {
    if (call.method === "GET") {
      if (call.url === API) return Response.json(data);
      if (call.url === `${GROUP_API}?includeArchived=true`) return Response.json({ groups: [...sampleGroups.values()].map(item => item.group), ruleOptions: samples.SAMPLE_GROUP_OPTIONS });
      if (call.url === CAMPAIGN_API) return Response.json({ campaigns, configuration: config });
      if (call.url.startsWith(`${CAMPAIGN_API}?id=`)) return Response.json({ campaign, outcomes: [], configuration: config });
      if (call.url.startsWith(`${API}/templates/`)) return Response.json({ template });
    }
    const body = JSON.parse(call.body);
    if (call.url === CAMPAIGN_API) {
      if (body.action === "save") { campaign = { ...body.draft, id: "campaign-1", revision: ++revision, status: "draft", createdAt: "2026-10-13T15:00:00Z", updatedAt: "2026-10-13T15:00:00Z" }; campaigns = [{ ...campaign, total: 0, pending: 0, sending: 0, sent: 0, unknown: 0, failed: 0, cancelled: 0 }]; return Response.json({ campaign }); }
      if (body.action === "review") return Response.json(reviewed);
      if (body.action === "send") { campaigns = campaigns.map(item => ({ ...item, status: "queued", total: 1, pending: 1 })); return Response.json({ status: "queued", id: "campaign-1", message: "Campaign queued for delivery." }); }
    }
    if (call.url === `${API}/preview`) return Response.json({ html: template.html, subject: body.edits.subject, from: template.from });
    if (call.url === `${API}/review`) return Response.json({ review: { ...reviewed, origin: undefined, mode: body.mode, segmentName: "Existing Resend segment" } });
    throw Error(`Unexpected request ${call.method} ${call.url}`);
  }
  const Component = compile("src/components/platform/OperatorEmailComposer.tsx", deps, async (url, options) => { const call = { url, ...options }; calls.push(call); return respond ? respond(call, fallback) : fallback(call); }, h.browser).default;
  const draw = () => h.render(Component, { preview }); const ui = controls(draw);
  async function setup() { draw(); await ui.settle(); ui.find(node => node.type === "button" && text(node).startsWith("Use template")).props.onClick(); await ui.settle(); ui.button("Audience campaign").props.onClick(); ui.change("resend-group", "sample-group-manual"); ui.change("resend-group-purpose", "membership_updates"); await h.flushTimers(450); await ui.settle(); }
  function ack() { ui.find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } }); }
  return { ...ui, setup, ack, calls, sampleGroups, config, flushPreview: () => h.flushTimers(450) };
}

test("Ruined campaigns save exact group revision and edits, review separately, and queue only the opaque review", async () => {
  const f = composerFixture(); await f.setup(); f.change("resend-subject", "Keep this subject"); f.change("resend-copy-0", "Keep this copy"); await f.flushPreview(); await f.settle(); await f.submit(); await f.settle();
  const writes = f.calls.filter(call => call.method === "POST" && call.url === CAMPAIGN_API).map(call => JSON.parse(call.body));
  assert.equal(writes[0].action, "save"); assert.equal(writes[0].draft.groupRevision, 1); assert.equal(writes[0].draft.purpose, "membership_updates"); assert.equal(writes[0].draft.edits.subject, "Keep this subject"); assert.equal(writes[0].draft.edits.copy.body, "Keep this copy");
  assert.deepEqual(writes[1], { action: "review", id: "campaign-1", revision: 1 }); assert.match(text(f.draw()), /Membership reminders are off/);
  f.ack(); const queue = f.button("Queue for 1 recipient"); assert.equal(queue.props.disabled, false); queue.props.onClick(); queue.props.onClick(); await f.settle();
  assert.deepEqual(f.calls.filter(call => call.body && JSON.parse(call.body).action === "send").map(call => JSON.parse(call.body)), [{ action: "send", reviewId: "review-1" }]);
  assert.equal(f.calls.filter(call => call.url === `${API}/send`).length, 0); assert.match(text(f.draw()), /Campaign queued for delivery/);
  assert.equal(f.find(node => node.type === "group-history").props.campaigns[0].status, "queued");
});

test("the native group delivery gate stays closed even when Resend is ready", async () => {
  const f = composerFixture({ sendingReady: false }); await f.setup(); await f.submit(); await f.settle(); f.ack();
  const queue = f.button("Queue for 1 recipient"); assert.equal(queue.props.disabled, true); queue.props.onClick(); await f.settle();
  assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "send").length, 0);
});

test("inline group selection preserves email copy and changing audience purpose invalidates review", async () => {
  const f = composerFixture(); await f.setup(); f.change("resend-subject", "Do not lose me"); f.change("resend-copy-0", "Custom body"); f.button("Create group").props.onClick();
  const groupDialog = f.find(node => node.type === "email-groups"); const group = { ...f.sampleGroups.get("sample-group-rule").group, revision: 2 };
  groupDialog.props.onGroupsChange(group); groupDialog.props.onSelect(group);
  assert.equal(f.find(node => node.props?.id === "resend-subject").props.value, "Do not lose me"); assert.equal(f.find(node => node.props?.id === "resend-copy-0").props.value, "Custom body");
  assert.equal(f.find(node => node.props?.id === "resend-group").props.value, group.id);
  await f.flushPreview(); await f.settle(); await f.submit(); await f.settle(); assert.ok(f.find(node => node.type === "dialog" && node.props.title === "Review email"));
  f.change("resend-group-purpose", "general_updates"); assert.equal(f.find(node => node.type === "dialog" && node.props.title === "Review email"), undefined);
  await f.submit(); await f.settle(); const saves = f.calls.filter(call => call.body && JSON.parse(call.body).action === "save").map(call => JSON.parse(call.body));
  assert.equal(saves.at(-1).draft.purpose, "general_updates"); assert.equal(saves.at(-1).draft.revision, 1); assert.equal(saves.at(-1).draft.groupRevision, 2);
});

test("refreshing a changed group invalidates its saved draft and review without losing edited copy", async () => {
  const f = composerFixture(); await f.setup(); f.change("resend-subject", "Current copy"); await f.submit(); await f.settle();
  const current = f.sampleGroups.get("sample-group-manual"); f.sampleGroups.set(current.group.id, { ...current, group: { ...current.group, revision: 2 } });
  f.button("Refresh workspace").props.onClick(); await f.settle();
  assert.equal(f.find(node => node.type === "dialog" && node.props.title === "Review email"), undefined); assert.match(text(f.draw()), /This group changed/);
  assert.equal(f.find(node => node.props?.id === "resend-subject").props.value, "Current copy"); await f.submit(); await f.settle();
  assert.equal(JSON.parse(f.calls.filter(call => call.body && JSON.parse(call.body).action === "save").at(-1).body).draft.groupRevision, 2);
});

test("switching to a Resend segment retains the existing provider review path", async () => {
  const f = composerFixture(); await f.setup(); f.change("resend-audience-source", "resend"); f.change("resend-segment", "segment-1"); f.change("resend-topic", "topic-1"); await f.submit(); await f.settle();
  const provider = f.calls.find(call => call.url === `${API}/review`); assert.ok(provider); const body = JSON.parse(provider.body);
  assert.equal(body.segmentId, "segment-1"); assert.equal(body.topicId, "topic-1"); assert.equal(f.calls.filter(call => call.url === CAMPAIGN_API && call.method === "POST").length, 0);
});

test("preview group campaigns can review sample recipients without any external request or sending", async () => {
  const f = composerFixture({ preview: true }); await f.setup(); await f.submit(); await f.settle();
  assert.match(text(f.draw()), /Audience recipients below are examples/); assert.equal(f.button("Sending off in preview").props.disabled, true);
  f.ack(); f.button("Sending off in preview").props.onClick(); await f.settle(); assert.equal(f.calls.length, 0);
});

test("campaign history separates provider acceptance, waiting and uncertain outcomes", () => {
  const campaign = { id: "one", name: "A campaign", groupId: "sample-group-manual", purpose: "membership_updates", status: "queued", updatedAt: "2026-10-13T15:00:00Z", sent: 2, pending: 1, sending: 1, unknown: 1, failed: 2, cancelled: 3 };
  const tree = history.default({ campaigns: [campaign], groups: [], selected: { campaign, outcomes: [{ id: "outcome", email: person.email, status: "unknown", reason: "Check Resend before retrying." }] }, query: "", busy: false, preview: false, onOpen() {}, onClose() {} });
  assert.match(text(tree), /2 sent · 2 waiting · 3 need attention · 3 cancelled/); assert.match(text(tree), /does not confirm inbox delivery/); assert.match(text(tree), /Check Resend before retrying/);
});

test("a failed readiness refresh closes the local queue gate without losing the reviewed draft", async () => {
  let failRefresh = false;
  const f = composerFixture({ respond: (call, fallback) => call.url === CAMPAIGN_API && call.method === "GET" && failRefresh ? Response.json({ error: "Temporarily unavailable" }, { status: 503 }) : fallback(call) });
  await f.setup(); await f.submit(); await f.settle(); f.ack(); assert.equal(f.button("Queue for 1 recipient").props.disabled, false);
  failRefresh = true; f.button("Refresh workspace").props.onClick(); await f.settle();
  assert.equal(f.button("Queue for 1 recipient").props.disabled, true); f.button("Queue for 1 recipient").props.onClick(); await f.settle();
  assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "send").length, 0);
});

test("dirty and pending group editing also protect parent workspace navigation", async () => {
  const f = composerFixture(); f.draw(); await f.settle(); f.button("Groups").props.onClick();
  let group = f.find(node => node.type === "email-groups"); group.props.onDirtyChange(true); f.button("Templates").props.onClick();
  assert.ok(f.find(node => node.type === "dialog" && node.props.title === "Unsaved email"));
  f.button("Keep editing").props.onClick(); group = f.find(node => node.type === "email-groups"); group.props.onPendingChange(true);
  const requests = f.calls.length; f.button("Refresh workspace").props.onClick(); f.button("Templates").props.onClick(); await f.settle();
  assert.equal(f.calls.length, requests); assert.ok(f.find(node => node.type === "email-groups")); assert.equal(f.find(node => node.type === "dialog"), undefined);
  group.props.onPendingChange(false); f.button("Templates").props.onClick(); f.button("Discard changes").props.onClick();
  assert.equal(f.find(node => node.type === "email-groups"), undefined);
});
