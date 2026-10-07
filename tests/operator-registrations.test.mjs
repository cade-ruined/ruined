import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const memberA = "00000000-0000-4000-8000-000000000101";
const memberB = "00000000-0000-4000-8000-000000000102";
const actor = "00000000-0000-4000-8000-000000000099";
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : node == null || typeof node === "boolean" ? "" : String(node);
const flush = () => new Promise(resolve => setImmediate(resolve));
async function load(path, deps = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), js)(name => name in deps ? deps[name] : require(name), loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const row = (memberId = memberA, changes = {}) => ({ memberId, name: memberId === memberA ? "Cherry Hill" : "Alex Rivera", email: memberId === memberA ? "cherry@example.test" : "alex@example.test", state: "registered", registeredAt: "2026-09-30T12:00:00Z", profileActivatedAt: null, requiresPaymentMethod: true, profileComplete: true, ready: true, version: memberId === memberA ? 2 : 5, welcomeStatus: "sent", activationEmailStatus: null, ...changes });

class RegistrationError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
async function apiFixture() {
  let viewer = { authUserId: actor }, denied = null, failure = null;
  const calls = [], delivery = [], deferred = [];
  const api = await load("app/api/ops/members/[memberId]/registration/route.ts", {
    "next/server": { after: callback => deferred.push(callback) },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
    "@/lib/platform/ops-api": {
      opsJson: (value, status = 200) => Response.json(value, { status }),
      requireOpsMutationRequest: async () => denied ? { response: Response.json({ error: "denied" }, { status: denied }) } : { viewer },
    },
    "@/lib/membership/registration-repository": {
      MemberRegistrationError: RegistrationError,
      getOpsMemberRegistration: async (...args) => { calls.push({ kind: "read", args }); if (failure) throw failure; return row(); },
      activateMemberRegistration: async (...args) => { calls.push({ kind: "activate", args }); if (failure) throw failure; return row(args[1], { state: "activated", version: args[2] + 1 }); },
    },
    "@/lib/membership/registration-message-delivery": { processRegistrationMessageBatch: async (...args) => { delivery.push(args); } },
  }, { console: { error() {} } });
  return { calls, delivery, deferred,
    get: (memberId = memberA) => api.GET(new Request("https://members.example.test/ops"), { params: Promise.resolve({ memberId }) }),
    post: (body = { action: "activate_profile", expectedVersion: 2 }, memberId = memberA) => api.POST(new Request("https://members.example.test/ops", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ memberId }) }),
    signedOut: () => { viewer = null; denied = 401; }, deny: status => { denied = status; }, fail: error => { failure = error; },
  };
}

test("operator registration API requires sign-in and mutation request authorization before repository access", async () => {
  const f = await apiFixture(); f.signedOut();
  assert.equal((await f.get()).status, 401); assert.equal((await f.post()).status, 401);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.deferred, []);
  const origin = await apiFixture(); origin.deny(403);
  assert.equal((await origin.post()).status, 403); assert.deepEqual(origin.calls, []);
});

test("admin repository receives verified actor, exact member ID and reviewed expected version", async () => {
  const f = await apiFixture();
  const read = await f.get(); assert.equal(read.status, 200);
  assert.deepEqual(f.calls[0], { kind: "read", args: [actor, memberA] });
  assert.equal(f.deferred.length, 0);
  const response = await f.post({ action: "activate_profile", expectedVersion: 7 }, memberB);
  assert.equal(response.status, 200); assert.equal((await response.json()).registration.state, "activated");
  assert.deepEqual(f.calls[1], { kind: "activate", args: [actor, memberB, 7] });
  assert.equal(f.deferred.length, 1); assert.deepEqual(f.delivery, []);
  await f.deferred[0](); assert.deepEqual(f.delivery, [[2, { memberId: memberB }]]);
});

test("strict activation input rejects malformed bodies, extra authority fields and bad versions without mutations", async () => {
  const f = await apiFixture();
  for (const body of ["not json", "null", "[]", "{}", { action: "activate_profile" }, { action: "activate_profile", expectedVersion: -1 }, { action: "activate_profile", expectedVersion: 1.5 }, { action: "activate_profile", expectedVersion: "2" }, { action: "activate_profile", expectedVersion: Number.MAX_SAFE_INTEGER + 1 }, { action: "activate_profile", expectedVersion: 2, authUserId: actor }, { action: "save_card", expectedVersion: 2 }]) {
    assert.equal((await f.post(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await f.post(" ".repeat(1001))).status, 413);
  assert.equal((await f.post(undefined, "../members")).status, 404);
  assert.equal((await f.get("not-a-uuid")).status, 404);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.deferred, []);
});

test("non-admin and stale-version errors are preserved and never queue delivery", async () => {
  for (const [status, message] of [[403, "Administrator access is required."], [409, "Registration changed. Refresh first."]]) {
    const f = await apiFixture(); f.fail(new RegistrationError(message, status));
    const response = await f.post(); assert.equal(response.status, status); assert.equal((await response.json()).error, message);
    assert.deepEqual(f.calls[0].args, [actor, memberA, 2]); assert.deepEqual(f.deferred, []);
    assert.equal((await f.get()).status, status);
  }
  const f = await apiFixture(); f.fail(Error("private provider details"));
  const response = await f.post(); assert.equal(response.status, 503); assert.doesNotMatch((await response.json()).error, /private provider/); assert.deepEqual(f.deferred, []);
});

function hooks() {
  let cursor = 0; const slots = [], effects = [];
  return { react: { ...React,
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useEffect(effect, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((value, index) => value !== old[index])) { slots[i] = deps; effects.push(effect); } },
  }, render(Component, props) { cursor = 0; let tree = Component(props); if (effects.length) { for (const effect of effects.splice(0)) effect(); cursor = 0; tree = Component(props); } return tree; } };
}
async function uiFixture({ rows = [row(), row(memberB)], preview = false, replies = [] } = {}) {
  const h = hooks(), calls = []; let refreshes = 0;
  const View = (await load("src/components/platform/OperatorRegistrations.tsx", {
    "@/lib/membership/operator-registration-progress": await load("src/lib/membership/operator-registration-progress.ts"),
    react: h.react, "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "./operatorStyles": { OPERATOR_BUTTON_CLASS: "button", OPERATOR_PRIMARY_ACTION_CLASS: "primary" },
  }, { fetch: async (url, options) => {
    const index = calls.length; calls.push({ url, body: JSON.parse(options.body), method: options.method });
    const reply = replies[index]; if (reply instanceof Error) throw reply; if (typeof reply === "function") return reply();
    const memberId = url.split("/").at(-2);
    return { ok: reply?.ok ?? true, json: async () => reply?.payload ?? { registration: row(memberId, { state: "activated", version: JSON.parse(options.body).expectedVersion + 1 }) } };
  } })).default;
  const props = { rows, preview }; const render = () => h.render(View, props);
  return { calls, render, button: label => nodes(render()).find(node => node.type === "button" && text(node) === label),
    select: label => nodes(render()).find(node => node.type === "input" && node.props["aria-label"] === `Select ${label}`),
    click: async label => { const button = nodes(render()).find(node => node.type === "button" && text(node) === label); assert.ok(button, label); button.props.onClick(); await flush(); },
    replaceRows: value => { props.rows = value; }, refreshes: () => refreshes };
}

test("operators must review the named recipients before activating, with each row's expected version", async () => {
  const f = await uiFixture();
  assert.equal(f.button("Open profiles & queue email"), undefined);
  await f.click("Select ready registrations"); assert.deepEqual(f.calls, []);
  await f.click("Review 2 profiles"); assert.deepEqual(f.calls, []);
  const review = nodes(f.render()).find(node => node.props["aria-labelledby"] === "profile-release-review");
  assert.match(text(review), /Cherry Hill · cherry@example.test/); assert.match(text(review), /Alex Rivera · alex@example.test/);
  await f.click("Open profiles & queue email");
  assert.deepEqual(f.calls, [
    { url: `/api/ops/members/${memberA}/registration`, method: "POST", body: { action: "activate_profile", expectedVersion: 2 } },
    { url: `/api/ops/members/${memberB}/registration`, method: "POST", body: { action: "activate_profile", expectedVersion: 5 } },
  ]);
  assert.match(text(f.render()), /2 profiles opened. Activation emails are queued/);
  assert.equal(f.button("Open profiles & queue email"), undefined);
});

test("unready, withdrawn-card and already-open accounts cannot be selected for release", async () => {
  const f = await uiFixture({ rows: [row(), row(memberB, { ready: false }), row("00000000-0000-4000-8000-000000000103", { name: "Incomplete", state: "collecting", profileComplete: false, ready: false }), row("00000000-0000-4000-8000-000000000104", { name: "Already open", state: "activated" })] });
  await f.click("All 4");
  assert.ok(f.select("Cherry Hill")); assert.equal(f.select("Alex Rivera"), undefined); assert.equal(f.select("Incomplete"), undefined); assert.equal(f.select("Already open"), undefined);
  assert.match(text(f.render()), /Card needed|Information needed/);
  await f.click("Select ready registrations"); await f.click("Review 1 profile"); await f.click("Open profiles & queue email");
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.expectedVersion, 2);
});

test("paid registration rows distinguish payment from complimentary and preserve profile holds", async () => {
  const progress = { state: "registered", registeredAt: "2026-10-06T18:00:00Z", profileComplete: true, ready: true,
    requiresInitialPayment: true, requiresPaymentMethod: false, completionBasis: "paid_membership", emailVerified: true,
    paymentMethodState: "missing", paymentConfirmed: true, billingArranged: true, billingState: "pending", serviceStartsAt: "2026-11-05T22:00:00Z" };
  const f = await uiFixture({ rows: [row(memberA, { requiresInitialPayment: true, requiresPaymentMethod: false, progress })] });
  assert.match(text(f.render()), /Payment received/);
  assert.match(text(f.render()), /Registration complete · profile held · service starts Nov 5/);
  assert.doesNotMatch(text(nodes(f.render()).find(node => node.type === "article")), /Complimentary|First payment needed|Card needed/);
  assert.deepEqual(f.calls, []);
});

test("a withdrawn saved card shows the original completed registration and the current action", async () => {
  const progress = { state: "registered", registeredAt: "2026-10-01T18:00:00Z", profileComplete: true, ready: false,
    requiresInitialPayment: false, requiresPaymentMethod: true, completionBasis: "saved_card", emailVerified: true,
    paymentMethodState: "removed", paymentConfirmed: false, billingArranged: false, billingState: "pending", serviceStartsAt: null };
  const f = await uiFixture({ rows: [row(memberA, { ready: false, progress })] });
  await f.click("All 1");
  assert.match(text(f.render()), /Card needed/);
  assert.match(text(f.render()), /Previously registered · saved card removed/);
  assert.match(text(f.render()), /This does not charge it/);
  assert.equal(f.select("Cherry Hill"), undefined);
});

test("preview can review sample registrations but cannot release or email even if its disabled callback is called", async () => {
  const f = await uiFixture({ preview: true });
  await f.click("Select ready registrations"); await f.click("Review 2 profiles");
  assert.equal(f.button("Open profiles & queue email").props.disabled, true);
  await f.click("Open profiles & queue email");
  assert.deepEqual(f.calls, []); assert.match(text(f.render()), /No access changes or emails can be sent/);
});

test("partial failure reports only confirmed releases and identifies the failed member", async () => {
  const f = await uiFixture({ replies: [undefined, { ok: false, payload: { error: "Registration changed. Refresh first." } }] });
  await f.click("Select ready registrations"); await f.click("Review 2 profiles"); await f.click("Open profiles & queue email");
  assert.match(text(f.render()), /1 profile opened. 1 need review/);
  assert.match(text(f.render()), /Alex Rivera: Registration changed/);
  assert.doesNotMatch(text(f.render()), /2 profiles opened/);
  assert.equal(f.select("Cherry Hill"), undefined); assert.equal(f.select("Alex Rivera").props.checked, true);
});

test("unconfirmed success payloads and network failures do not become successful releases", async () => {
  const f = await uiFixture({ replies: [{ ok: true, payload: { registration: row(memberB, { state: "activated" }) } }, Error("Connection lost.")] });
  await f.click("Select ready registrations"); await f.click("Review 2 profiles"); await f.click("Open profiles & queue email");
  assert.match(text(f.render()), /0 profiles opened. 2 need review/); assert.match(text(f.render()), /Opening the profile was not confirmed/); assert.match(text(f.render()), /Connection lost/);
});

test("duplicate activation clicks remain one batch, and refreshed rows discard obsolete review versions", async () => {
  let finish;
  const f = await uiFixture({ rows: [row()], replies: [() => new Promise(resolve => { finish = resolve; })] });
  await f.click("Select ready registrations"); await f.click("Review 1 profile");
  const confirm = f.button("Open profiles & queue email"); confirm.props.onClick(); confirm.props.onClick();
  assert.equal(f.calls.length, 1); assert.equal(f.button("Opening profiles…").props.disabled, true);
  finish({ ok: true, json: async () => ({ registration: row(memberA, { state: "activated", version: 3 }) }) }); await flush();
  assert.equal(f.calls.length, 1);
  const updated = await uiFixture({ rows: [row()] }); await updated.click("Select ready registrations"); await updated.click("Review 1 profile");
  updated.replaceRows([row(memberA, { version: 8 })]); updated.render();
  assert.equal(updated.button("Open profiles & queue email"), undefined); assert.equal(updated.select("Cherry Hill").props.checked, false);
  await updated.click("Select ready registrations"); await updated.click("Review 1 profile"); await updated.click("Open profiles & queue email");
  assert.equal(updated.calls[0].body.expectedVersion, 8);
});

test("operations registration page is admin-only, and preview never reads live registrations", async () => {
  let current = { state: "authenticated", role: "ops_admin", viewer: { authUserId: actor }, dashboard: {} };
  const reads = [], View = () => null, Unavailable = () => null;
  const Page = (await load("app/ops/registrations/page.tsx", {
    "next/navigation": { redirect: href => { throw Object.assign(Error("redirect"), { href }); } },
    "@/components/platform/OperatorPageFrame": () => null, "@/components/platform/OperatorRegistrations": View,
    "@/components/platform/PlatformUnavailable": Unavailable,
    "@/lib/platform/page-data": { getOperatorPageContext: async () => current },
    "@/lib/membership/registration-repository": { getOpsMemberRegistrations: async id => { reads.push(id); return [row()]; } },
  })).default;
  assert.equal(nodes(await Page()).find(node => node.type === View).props.preview, false); assert.deepEqual(reads, [actor]);
  current = { ...current, role: "circle_leader" }; assert.equal((await Page()).type, Unavailable); assert.equal(reads.length, 1);
  current = { state: "preview", viewer: null, dashboard: {} }; const preview = nodes(await Page()).find(node => node.type === View);
  assert.equal(preview.props.preview, true); assert.ok(preview.props.rows.every(item => item.email.endsWith("example.test"))); assert.equal(reads.length, 1);
  current = { state: "signed_out" }; await assert.rejects(Page, error => error.href === "/ops/access");
});

test("legacy paid and unpaid registrations stay distinct in the profile access queue", async () => {
  const progress = { state: "registered", registeredAt: "2026-10-01T18:00:00Z", profileComplete: true, ready: true,
    requiresInitialPayment: false, requiresPaymentMethod: true, completionBasis: "saved_card", emailVerified: true,
    paymentMethodState: "saved", paidCheckoutAvailable: true, paymentConfirmed: true, billingArranged: true,
    billingState: "pending", serviceStartsAt: "2026-11-05T22:00:00Z" };
  const f = await uiFixture({ rows: [row(memberA, { progress }), row(memberB, { progress: { ...progress, paymentConfirmed: false, billingArranged: false } })] });
  assert.match(text(f.render()), /Awaiting profile access/);
  assert.doesNotMatch(text(f.render()), /Ready to open/);
  const articles=nodes(f.render()).filter(node=>node.type==="article");
  assert.match(text(articles[0]), /Payment received/);
  assert.doesNotMatch(text(articles[0]), /First payment needed|Card needed/);
  assert.match(text(articles[1]), /First payment needed/);
  assert.match(text(articles[1]), /Card saved · not charged/);
  assert.deepEqual(f.calls,[]);
});

test("payment filters narrow the current access queue without treating saved cards or arrangements as paid", async () => {
  const progress = { state: "registered", registeredAt: "2026-10-01T18:00:00Z", profileComplete: true, ready: true,
    requiresInitialPayment: false, requiresPaymentMethod: true, completionBasis: "saved_card", emailVerified: true,
    paymentMethodState: "saved", paidCheckoutAvailable: true, paymentConfirmed: false, billingArranged: false,
    billingState: "pending", serviceStartsAt: null };
  const f=await uiFixture({rows:[
    row(memberA,{name:"Saved only",progress}),
    row(memberB,{name:"Paid held",progress:{...progress,paymentConfirmed:true}}),
    row("00000000-0000-4000-8000-000000000103",{name:"Complimentary held",requiresPaymentMethod:false,progress:{...progress,requiresPaymentMethod:false,completionBasis:"complimentary"}}),
    row("00000000-0000-4000-8000-000000000104",{name:"Arranged only",progress:{...progress,billingArranged:true}}),
    row("00000000-0000-4000-8000-000000000105",{name:"Needs details",state:"collecting",registeredAt:null,ready:false,profileComplete:false,progress:{...progress,profileComplete:false}}),
    row("00000000-0000-4000-8000-000000000106",{name:"Paid open",state:"activated",progress:{...progress,paymentConfirmed:true}}),
  ]});
  const shown=()=>nodes(f.render()).filter(node=>node.type==="article").map(text).join("\n");
  assert.equal(f.button("All statuses 4").props["aria-pressed"],true);
  await f.click("Paid 1");assert.match(shown(),/Paid held/);assert.doesNotMatch(shown(),/Saved only|Paid open|Arranged only/);
  await f.click("Needs payment 1");assert.match(shown(),/Saved only/);assert.doesNotMatch(shown(),/Paid held|Arranged only/);
  await f.click("Complimentary 1");assert.match(shown(),/Complimentary held/);
  await f.click("Needs review 1");assert.match(shown(),/Arranged only/);assert.doesNotMatch(shown(),/Paid held/);
  await f.click("All 6");await f.click("Needs information 1");assert.match(shown(),/Needs details/);
  await f.click("Paid 2");assert.match(shown(),/Paid held/);assert.match(shown(),/Paid open/);
  await f.click("Select ready registrations");await f.click("Review 1 profile");
  const review=nodes(f.render()).find(node=>node.props["aria-labelledby"]==="profile-release-review");
  assert.match(text(review),/Paid held/);assert.doesNotMatch(text(review),/Paid open|Saved only/);
  await f.click("Needs payment 1");assert.equal(f.button("Open profiles & queue email"),undefined);
  assert.equal(f.select("Saved only").props.checked,false);
  assert.deepEqual(f.calls,[],"Filtering or selecting never opens access or sends messages");
});
