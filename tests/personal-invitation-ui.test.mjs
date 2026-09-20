import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, property) => property }) };
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const expiry = await load("src/lib/membership/invitation-expiry.ts");
const presentation = await load("src/lib/membership/personal-invitation-presentation.ts");
const future = "2099-09-20T02:45:00.000Z", past = "2000-01-01T00:00:00.000Z";
const record = { id: "personal-one", recipientName: "Alex <Rivera>", recipientEmail: "alex@example.test", url: "/invitation/personal-one", issuedAt: "2099-09-18T02:45:00.000Z", expiresAt: future, revokedAt: null, submittedAt: null, acceptedAt: null, joinedAt: null, deliveryStatus: "queued", sentAt: null, version: 3, membershipType: "standard", complimentaryReason: null, complimentaryEndsAt: null, complimentaryGrant: null };
const snapshot = { card: { name: "Inviter", memberTag: "inviter", wearSeed: "owner" }, invitations: [], counts: { created: 0, active: 0, expired: 0, accepted: 0, submitted: 0, joined: 0 }, eligible: true, writable: true, emailReady: true, dailyLimit: 20, remainingToday: 20, legacyInvitation: null, canGrantComplimentary: false };
const descendants = element => React.isValidElement(element) ? [element, ...React.Children.toArray(element.props.children).flatMap(descendants)] : [];
const text = element => typeof element === "string" || typeof element === "number" ? String(element) : React.isValidElement(element) ? React.Children.toArray(element.props.children).map(text).join("") : "";
const find = (tree, type, label) => descendants(tree).find(element => element.type === type && text(element) === label);
const input = (tree, name) => descendants(tree).find(element => element.type === "input" && element.props.name === name);
const select = (tree, name) => descendants(tree).find(element => element.type === "select" && element.props.name === name);
const form = tree => descendants(tree).find(element => element.type === "form");
async function harness(initialSnapshot = snapshot, options = {}) {
  const hooks = []; let cursor = 0, uuids = 0;
  const calls = [], copied = [];
  const fakeReact = { ...React,
    useState: initial => { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], next => { hooks[slot] = typeof next === "function" ? next(hooks[slot]) : next; }]; },
    useRef: initial => { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = { current: initial }; return hooks[slot]; },
    useEffect: () => {}, useDeferredValue: value => value,
  };
  const component = await load("src/components/membership/MemberInvitation.tsx", {
    react: fakeReact, "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "@/components/public-members/MembershipWaitlistForm": () => null,
    "./PersonalInvitationAcceptance": () => null,
    "./card/PublicMemberCardPage": ({ children }) => React.createElement("main", null, children),
    "@/lib/membership/invitation-expiry": expiry,
    "@/lib/membership/personal-invitation-presentation": presentation,
    "./use-invitation-expiry": { useInvitationExpired: value => expiry.memberInvitationExpired(value) },
  }, {
    crypto: { randomUUID: () => `request-${++uuids}` },
    window: { location: { origin: "https://members.example.test" } },
    navigator: { clipboard: { writeText: async value => { copied.push(value); } } },
    fetch: async (url, init) => { const call = { url, ...init, body: init.body ? JSON.parse(init.body) : undefined }; calls.push(call); return options.fetch ? options.fetch(call) : { ok: true, json: async () => ({ snapshot: { ...snapshot, invitations: [record], counts: { ...snapshot.counts, created: 1 } } }) }; },
  });
  const render = () => { cursor = 0; return component.default({ initialSnapshot, preview: options.preview }); };
  return { render, calls, copied };
}

test("creating a named invitation uses only recipient, delivery choice and retry-safe request identity", async () => {
  const ui = await harness();
  input(ui.render(), "recipientName").props.onChange({ target: { value: " Alex Rivera " } });
  input(ui.render(), "recipientEmail").props.onChange({ target: { value: " alex@example.test " } });
  assert.equal(ui.render().props.invitationRecipientName, "Alex Rivera");
  await form(ui.render()).props.onSubmit({ preventDefault() {} });
  assert.deepEqual(ui.calls.map(({ url, method, body }) => ({ url, method, body })), [{ url: "/api/my/invitations", method: "POST", body: { recipientName: "Alex Rivera", recipientEmail: "alex@example.test", requestId: "request-1", sendEmail: true } }]);
  const created = ui.render();
  assert.equal(created.props.invitationRecipientName, record.recipientName);
  assert.equal(created.props.invitationExpiresAt, future);
  assert.match(renderToStaticMarkup(created), /Their email is queued/);
  assert.equal(input(created, "recipientName").props.value, "");
});

test("only admin snapshots expose membership choice, directly after recipient email", async () => {
  const member = await harness();
  assert.equal(select(member.render(), "membershipType"), undefined);
  assert.equal(input(member.render(), "complimentaryReason"), undefined);
  const admin = await harness({ ...snapshot, canGrantComplimentary: true });
  const tree = admin.render(), controls = descendants(tree).filter(element => element.type === "input" || element.type === "select");
  assert.deepEqual(controls.slice(0, 3).map(element => element.props.name), ["recipientName", "recipientEmail", "membershipType"]);
  assert.equal(select(tree, "membershipType").props.value, "standard");
  assert.equal(input(tree, "complimentaryReason"), undefined);
});

test("admin complimentary invitations default to ongoing and preserve the 48-hour acceptance deadline", async () => {
  const ui = await harness({ ...snapshot, canGrantComplimentary: true });
  input(ui.render(), "recipientName").props.onChange({ target: { value: "Alex" } });
  input(ui.render(), "recipientEmail").props.onChange({ target: { value: "alex@example.test" } });
  select(ui.render(), "membershipType").props.onChange({ target: { value: "complimentary" } });
  const tree = ui.render();
  assert.equal(input(tree, "complimentaryReason").props.value, "Founding member");
  assert.equal(input(tree, "complimentaryReason").props.required, true);
  assert.equal(select(tree, "complimentaryDuration").props.value, "ongoing");
  assert.equal(input(tree, "complimentaryEndDate"), undefined);
  assert.match(text(tree), /The invitation still has 48 hours to be accepted/);
  await form(tree).props.onSubmit({ preventDefault() {} });
  assert.deepEqual(ui.calls[0].body, { recipientName: "Alex", recipientEmail: "alex@example.test", requestId: "request-1", sendEmail: true, membershipType: "complimentary", complimentaryReason: "Founding member", complimentaryEndsAt: null });
});

test("date-limited complimentary invites save local end of day and edited terms use a new request identity", async () => {
  const ui = await harness({ ...snapshot, canGrantComplimentary: true }, { fetch: async () => ({ ok: false, json: async () => ({ error: "Try again" }) }) });
  input(ui.render(), "recipientName").props.onChange({ target: { value: "Alex" } });
  input(ui.render(), "recipientEmail").props.onChange({ target: { value: "alex@example.test" } });
  select(ui.render(), "membershipType").props.onChange({ target: { value: "complimentary" } });
  select(ui.render(), "complimentaryDuration").props.onChange({ target: { value: "limited" } });
  await form(ui.render()).props.onSubmit({ preventDefault() {} });
  assert.equal(ui.calls.length, 0, "an end date is required when duration is limited");
  input(ui.render(), "complimentaryEndDate").props.onChange({ target: { value: "2099-09-30" } });
  const end = presentation.complimentaryEndOfLocalDay("2099-09-30");
  assert.match(text(ui.render()), /Saved deadline:/);
  await form(ui.render()).props.onSubmit({ preventDefault() {} });
  await form(ui.render()).props.onSubmit({ preventDefault() {} });
  assert.equal(ui.calls[0].body.complimentaryEndsAt, end);
  assert.equal(ui.calls[0].body.requestId, ui.calls[1].body.requestId);
  input(ui.render(), "complimentaryReason").props.onChange({ target: { value: "  Guest membership  " } });
  await form(ui.render()).props.onSubmit({ preventDefault() {} });
  assert.notEqual(ui.calls[2].body.requestId, ui.calls[0].body.requestId);
  assert.equal(ui.calls[2].body.complimentaryReason, "Guest membership");
  select(ui.render(), "membershipType").props.onChange({ target: { value: "standard" } });
  await form(ui.render()).props.onSubmit({ preventDefault() {} });
  assert.equal(ui.calls[3].body.membershipType, "standard");
  assert.equal("complimentaryEndsAt" in ui.calls[3].body, false, "hidden complimentary terms must not leak into a standard invitation");
});

test("empty reasons and past or invalid complimentary dates cannot be submitted", async () => {
  const ui = await harness({ ...snapshot, canGrantComplimentary: true });
  input(ui.render(), "recipientName").props.onChange({ target: { value: "Alex" } });
  input(ui.render(), "recipientEmail").props.onChange({ target: { value: "alex@example.test" } });
  select(ui.render(), "membershipType").props.onChange({ target: { value: "complimentary" } });
  input(ui.render(), "complimentaryReason").props.onChange({ target: { value: "   " } });
  await form(ui.render()).props.onSubmit({ preventDefault() {} });
  assert.match(text(ui.render()), /Add a reason/);
  input(ui.render(), "complimentaryReason").props.onChange({ target: { value: "Founding member" } });
  select(ui.render(), "complimentaryDuration").props.onChange({ target: { value: "limited" } });
  for (const date of ["2000-01-01", "2099-02-30", ""]) {
    input(ui.render(), "complimentaryEndDate").props.onChange({ target: { value: date } });
    await form(ui.render()).props.onSubmit({ preventDefault() {} });
    assert.match(text(ui.render()), /Choose a future end date/);
  }
  assert.equal(ui.calls.length, 0);
});

test("accepted complimentary access has a separate confirmed end action, never a cancel-invitation action", async () => {
  const complimentary = { ...record, membershipType: "complimentary", acceptedAt: past, complimentaryReason: "Founding member", complimentaryGrant: { id: "grant-1", startsAt: past, endsAt: null, revokedAt: null } };
  const ui = await harness({ ...snapshot, canGrantComplimentary: true, invitations: [complimentary] });
  assert.match(text(ui.render()), /Ongoing complimentary membership/);
  assert.equal(find(ui.render(), "button", "Cancel invitation"), undefined);
  find(ui.render(), "button", "End complimentary access").props.onClick();
  assert.equal(ui.calls.length, 0);
  assert.match(text(ui.render()), /Their member record and history stay in place/);
  find(ui.render(), "button", "Keep complimentary access").props.onClick();
  assert.equal(find(ui.render(), "button", "Yes, end complimentary access"), undefined);
  find(ui.render(), "button", "End complimentary access").props.onClick();
  await find(ui.render(), "button", "Yes, end complimentary access").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ui.calls[0].body, { action: "end_complimentary", version: 3 });
  assert.equal(ui.calls[0].url, "/api/my/invitations/personal-one");
  assert.equal(ui.calls[0].method, "PATCH");
  assert.match(text(ui.render()), /Complimentary access for Alex <Rivera> ended/);
});

test("only admins can end current grants; ended and unaccepted complimentary records retain honest states", async () => {
  const comp = { ...record, membershipType: "complimentary", complimentaryReason: "Founding member" };
  const grant = { id: "grant-1", startsAt: past, endsAt: null, revokedAt: null };
  const member = await harness({ ...snapshot, invitations: [{ ...comp, acceptedAt: past, complimentaryGrant: grant }] });
  assert.equal(find(member.render(), "button", "End complimentary access"), undefined);
  assert.doesNotMatch(text(member.render()), /Founding member/);
  const admin = await harness({ ...snapshot, canGrantComplimentary: true, invitations: [comp, { ...comp, id: "ended", acceptedAt: past, complimentaryGrant: { ...grant, revokedAt: past } }, { ...comp, id: "elapsed", acceptedAt: past, complimentaryEndsAt: past, complimentaryGrant: { ...grant, endsAt: past } }] });
  const rows = descendants(admin.render()).filter(element => element.type === "li");
  assert.ok(find(rows[0], "button", "Cancel invitation"));
  for (const row of rows) assert.equal(find(row, "button", "End complimentary access"), undefined);
  assert.match(text(rows[1]), /Complimentary access ended/);
  assert.match(text(rows[2]), /Complimentary access ended/);
});

test("complimentary local end dates retain calendar boundaries and account for daylight saving", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Denver";
  try {
    assert.equal(presentation.complimentaryEndOfLocalDay("2026-09-30"), "2026-10-01T05:59:59.999Z");
    assert.equal(presentation.complimentaryEndOfLocalDay("2026-12-31"), "2027-01-01T06:59:59.999Z");
    assert.equal(presentation.complimentaryEndOfLocalDay("2026-03-08"), "2026-03-09T05:59:59.999Z");
    assert.equal(presentation.complimentaryEndOfLocalDay("2026-11-01"), "2026-11-02T06:59:59.999Z");
    assert.equal(presentation.complimentaryEndOfLocalDay("2028-02-29"), "2028-03-01T06:59:59.999Z");
    for (const invalid of ["", "2026-02-29", "2026-13-01", "2026-00-00", "2026-9-30", "2026-09-30T00:00:00Z"]) assert.equal(presentation.complimentaryEndOfLocalDay(invalid), null);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("a failed create retries the same request id and changed details create a new request", async () => {
  const ui = await harness(snapshot, { fetch: async () => ({ ok: false, json: async () => ({ error: "Try again" }) }) });
  input(ui.render(), "recipientName").props.onChange({ target: { value: "Alex" } });
  input(ui.render(), "recipientEmail").props.onChange({ target: { value: "alex@example.test" } });
  for (let attempt = 0; attempt < 2; attempt++) await form(ui.render()).props.onSubmit({ preventDefault() {} });
  assert.equal(ui.calls[0].body.requestId, ui.calls[1].body.requestId);
  input(ui.render(), "recipientName").props.onChange({ target: { value: "Sam" } });
  await form(ui.render()).props.onSubmit({ preventDefault() {} });
  assert.notEqual(ui.calls[2].body.requestId, ui.calls[0].body.requestId);
});

test("preview, inactive, read-only and daily-limit views cannot create or send", async () => {
  for (const [initial, options] of [[snapshot, { preview: true }], [{ ...snapshot, eligible: false }, {}], [{ ...snapshot, writable: false }, {}], [{ ...snapshot, remainingToday: 0 }, {}]]) {
    const ui = await harness(initial, options), tree = ui.render();
    assert.equal(descendants(tree).find(element => element.type === "button" && element.props.type === "submit").props.disabled, true);
    await form(tree).props.onSubmit({ preventDefault() {} });
    assert.equal(ui.calls.length, 0);
  }
  const ui = await harness({ ...snapshot, emailReady: false });
  assert.ok(find(ui.render(), "button", "Create invitation↗"));
  assert.match(renderToStaticMarkup(ui.render()), /Email delivery isn’t available/);
});

test("history preserves individual deadlines and accepted outcomes, with expired links unshareable", async () => {
  const expired = { ...record, id: "expired", recipientName: "Expired person", expiresAt: past };
  const requested = { ...expired, id: "requested", recipientName: "Requested person", submittedAt: past };
  const accepted = { ...expired, id: "accepted", recipientName: "Accepted person", acceptedAt: past };
  const joined = { ...expired, id: "joined", recipientName: "Joined person", submittedAt: past, joinedAt: past };
  const cancelled = { ...record, id: "cancelled", recipientName: "Cancelled person", revokedAt: past };
  const ui = await harness({ ...snapshot, invitations: [record, expired, requested, joined, cancelled, accepted], counts: { created: 6, active: 1, expired: 1, accepted: 1, submitted: 2, joined: 1 } });
  const tree = ui.render(), rows = descendants(tree).filter(element => element.type === "li");
  assert.equal(rows.length, 6);
  for (const row of rows.slice(1)) assert.equal(find(row, "button", "Copy link"), undefined);
  assert.match(text(rows[1]), /Expired/); assert.match(text(rows[2]), /Requested/); assert.match(text(rows[3]), /Joined/); assert.match(text(rows[4]), /Cancelled/); assert.match(text(rows[5]), /Accepted/);
  for (const row of [rows[3], rows[5]]) {
    assert.equal(find(row, "button", "Cancel invitation"), undefined);
    assert.equal(find(row, "button", "Retry email"), undefined);
    assert.match(text(row), /Original deadline/);
  }
  descendants(rows[1]).find(element => element.type === "button" && element.props["aria-label"] === "Preview invitation for Expired person").props.onClick();
  assert.equal(ui.render().props.invitationRecipientName, "Expired person"); assert.equal(ui.render().props.invitationExpiresAt, past);
  find(ui.render(), "button", "Expired").props.onClick();
  assert.equal(descendants(ui.render()).filter(element => element.type === "li").length, 1);
  find(ui.render(), "button", "Accepted").props.onClick();
  assert.match(text(descendants(ui.render()).find(element => element.type === "li")), /Accepted person/);
});

test("copy does not write or renew, cancellation is explicit and affects only its record", async () => {
  const ui = await harness({ ...snapshot, invitations: [record] });
  await find(ui.render(), "button", "Copy link").props.onClick();
  assert.deepEqual(ui.copied, ["https://members.example.test/invitation/personal-one"]); assert.equal(ui.calls.length, 0);
  find(ui.render(), "button", "Cancel invitation").props.onClick();
  assert.equal(ui.calls.length, 0);
  await find(ui.render(), "button", "Yes, cancel invitation").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ui.calls.map(({ url, method, body }) => ({ url, method, body })), [{ url: "/api/my/invitations/personal-one", method: "PATCH", body: { action: "revoke", version: 3 } }]);
});

test("failed delivery can retry without extending the deadline or generating another invitation", async () => {
  const ui = await harness({ ...snapshot, invitations: [{ ...record, deliveryStatus: "failed" }] });
  assert.match(renderToStaticMarkup(ui.render()), /Email didn’t send/);
  await find(ui.render(), "button", "Retry email").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ui.calls[0].body, { action: "retry_email", version: 3 });
  assert.match(renderToStaticMarkup(ui.render()), /original deadline stays the same/);
});

test("earlier shared invitations keep their own links and do not invent a named recipient", async () => {
  const ui = await harness({ ...snapshot, legacyInvitation: { url: "/invitation/legacy", issuedAt: record.issuedAt, expiresAt: future, enabled: true, version: 9 } });
  assert.match(renderToStaticMarkup(ui.render()), /Earlier shared invitation/);
  assert.equal(ui.render().props.invitationRecipientName, null);
  await find(ui.render(), "button", "Copy earlier link").props.onClick();
  assert.deepEqual(ui.copied, ["https://members.example.test/invitation/legacy"]);
  assert.equal(ui.calls.length, 0);
});
