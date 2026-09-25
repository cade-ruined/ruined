import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as pricing from "../src/lib/membership/pricing.ts";

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" ? node : "";
const event = { preventDefault() {} };
const Stub = () => null;
async function requestFixture(handler) {
  const slots = [], calls = [], locked = []; let cursor = 0, nextId = 0;
  const hooks = { ...React, useId: () => "request-form",
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
  };
  const component = (await load("src/components/public-members/DirectInvitationRequestForm.tsx", { react: hooks, "next/link": "a" }, {
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}` },
    fetch: async (url, init) => { const call = { url, body: JSON.parse(init.body), method: init.method }; calls.push(call); return handler ? handler(call) : { ok: true, json: async () => ({ ok: true, requestId: "generic-reference" }) }; },
  })).default;
  const props = { billingPlan: "annual", onRequestStateChange: value => locked.push(value) };
  const draw = () => { cursor = 0; return component(props); };
  const fill = (name, value) => nodes(draw()).find(node => node.props.name === name).props.onChange({ target: { value } });
  fill("recipientName", " Alex   Rivera "); fill("recipientEmail", " ALEX@Example.test ");
  return { draw, fill, calls, locked, props };
}

test("public signup requests an email invitation with name, selected plan, and retry-safe identity", async () => {
  const f = await requestFixture();
  await f.draw().props.onSubmit(event);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { url: "/api/membership/signup/invitation", method: "POST", body: {
    requestId: "00000000-0000-4000-8000-000000000001", recipientName: "Alex Rivera", recipientEmail: "alex@example.test", billingPlan: "annual",
  } });
  assert.deepEqual(f.locked, [true]);
  assert.match(text(f.draw()), /request has been received/);
  assert.match(text(f.draw()), /Already a member\?/);
  assert.equal(nodes(f.draw()).some(node => node.type === "form"), false, "success cannot resend from a second click");
});

test("an uncertain request retries the same identity; changed details receive a new identity", async () => {
  const f = await requestFixture(async () => { throw new Error("Network interrupted"); });
  await f.draw().props.onSubmit(event); await f.draw().props.onSubmit(event);
  assert.equal(f.calls[0].body.requestId, f.calls[1].body.requestId);
  assert.match(text(f.draw()), /Network interrupted/);
  f.fill("recipientName", "New name"); await f.draw().props.onSubmit(event);
  assert.notEqual(f.calls[1].body.requestId, f.calls[2].body.requestId);
  f.props.billingPlan = "monthly"; await f.draw().props.onSubmit(event);
  assert.notEqual(f.calls[2].body.requestId, f.calls[3].body.requestId);
  assert.deepEqual(f.locked, [true, false, true, false, true, false, true, false]);
});

test("in-flight native submits cannot create duplicate requests and returned URLs are never opened", async () => {
  let release;
  const f = await requestFixture(() => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ ok: true, url: "https://untrusted.example", invitationToken: "private-value" }) }); }));
  const first = f.draw().props.onSubmit(event); await f.draw().props.onSubmit(event);
  assert.equal(f.calls.length, 1); release(); await first;
  assert.doesNotMatch(text(f.draw()), /untrusted|private-value/);
});

test("unopened signup renders the waitlist; launched signup keeps exact prices and invitation form", async () => {
  const component = (await load("src/components/public-members/MembershipSignup.tsx", {
    react: React, "@/lib/membership/pricing": pricing,
    "./DirectInvitationRequestForm": props => React.createElement("div", { "data-request-plan": props.billingPlan }),
    "./MembershipWaitlistForm": props => React.createElement("form", { "aria-label": "Membership waitlist", "data-disabled": String(props.disabled) }),
  })).default;
  const render = props => renderToStaticMarkup(React.createElement(component, { plan: "annual", onPlanChange() {}, ...props }));
  const closed = render({ enabled: false });
  assert.match(closed, /Membership waitlist/); assert.doesNotMatch(closed, /data-request-plan|\$5,040|Verify email/);
  assert.match(render({ enabled: false, preview: true }), /data-disabled="true"/);
  const live = render({ enabled: true });
  assert.match(live, /\$5,040/); assert.match(live, /data-request-plan="annual"/); assert.match(live, /Your invitation/);
  assert.doesNotMatch(live, /Membership waitlist/);
});

const privateCard = { name: "Private Member", memberTag: "private-tag", avatarUrl: null, memberSince: "2020-01-01T00:00:00Z", location: "Private location", bio: "Private bio", buildingNow: "Private project", websiteUrl: "https://private.example", labels: ["Private label"], wearSeed: "test" };
const cardModel = await load("src/lib/membership/public-card-model.ts");
const expiry = await load("src/lib/membership/invitation-expiry.ts");

test("direct card details are a brand invitation and never substitute a member identity", async () => {
  const component = (await load("src/components/membership/card/MemberCard.tsx", {
    react: React, "next/dynamic": () => Stub, "@/lib/membership/public-card-model": cardModel,
    "./card-artwork": {}, "@/lib/membership/invitation-expiry": expiry, "./AmbientParticles": Stub,
  })).default;
  const html = renderToStaticMarkup(React.createElement(component, { card: privateCard, variant: "invitation", invitationSource: "ruined_direct", invitationRecipientName: "Alex", invitationExpiresAt: "2099-01-01T00:00:00Z" }));
  assert.match(html, /The Ruined Project/); assert.match(html, /Ruined Direct/); assert.match(html, /This is for Alex/);
  assert.doesNotMatch(html, /Private Member|private-tag|Private location|Private bio|Private project|Private label|private\.example|Member since/);
  const member = renderToStaticMarkup(React.createElement(component, { card: privateCard, variant: "invitation" }));
  assert.match(member, /Private Member/); assert.match(member, /@private-tag/);
});

test("Ruined Direct history labels acquisition separately, carries search pagination, and links verified member records", async () => {
  let refreshes = 0;
  const component = (await load("src/components/platform/OperatorDirectInvitations.tsx", {
    react: React, "next/link": "a", "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "./operatorStyles": { OPERATOR_BUTTON_CLASS: "button", OPERATOR_FIELD_CLASS: "field" },
  })).default;
  const entry = { id: "inv-1", origin: "ruined_direct", sourceLabel: "Ruined Direct", recipientName: "Alex <Rivera>", recipientEmail: "alex@example.test", billingPlan: "annual", issuedAt: "2026-09-24T00:00:00Z", expiresAt: "2026-09-26T00:00:00Z", sentAt: null, acceptedAt: "2026-09-24T01:00:00Z", joinedAt: null, acceptedMemberId: "member-1", deliveryStatus: "sent", status: "accepted" };
  const props = { data: { entries: [entry], query: "alex", page: 1, pageCount: 2, totalResults: 26, counts: { created: 30, accepted: 4, joined: 2, expired: 1, failed: 0 } }, directoryParams: { q: "Ty", filter: "all", page: "2" } };
  const html = renderToStaticMarkup(React.createElement(component, props));
  assert.match(html, /tracked separately from member referrals/); assert.match(html, /Alex &lt;Rivera&gt;/);
  assert.match(html, /directInvitationQ=alex.*directInvitationPage=2#direct-invitations/);
  assert.match(html, /href="\/ops\/members\/member-1"/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(component, { ...props, preview: true })), /href="\/ops\/members\/member-1"/);
  const tree = component(props); nodes(tree).find(node => node.type === "button" && text(node) === "Refresh list").props.onClick(); assert.equal(refreshes, 1);
});

test("invitation-form preview cannot issue requests, even through native event invocation", async () => {
  const f = await requestFixture(() => assert.fail("Preview must never issue an invitation"));
  f.props.preview = true;
  const tree = f.draw();
  assert.equal(nodes(tree).find(node => node.type === "fieldset").props.disabled, true);
  assert.match(text(tree), /delivery, account creation, and payments are disabled/);
  await tree.props.onSubmit(event); assert.equal(f.calls.length, 0);
});

test("signup preview query can reveal the inert form only in preview mode and never opens the launch gate", async () => {
  let configuration = { mode: "preview", stripeCheckoutReady: false };
  const page = await load("app/signup/page.tsx", {
    "@/components/public-members/MembershipSignupPage": Stub,
    "@/lib/membership/pricing": pricing,
    "@/lib/platform/config": { getPlatformConfiguration: () => configuration },
  });
  const route = preview => page.default({ searchParams: Promise.resolve({ preview, plan: "annual" }) });
  assert.equal((await route(undefined)).props.previewInvitation, false, "default preview keeps the waitlist");
  const preview = await route("invitation");
  assert.equal(preview.props.previewInvitation, true); assert.equal(preview.props.enabled, false);
  for (const mode of ["connected", "unavailable"]) {
    configuration = { mode, stripeCheckoutReady: false };
    const actual = await route("invitation");
    assert.equal(actual.props.previewInvitation, false); assert.equal(actual.props.enabled, false);
  }
});

test("direct card preview uses an explicit source and fictional recipient while production remains unavailable", async () => {
  let mode = "preview";
  const page = await load("app/invitation/preview/page.tsx", {
    "next/navigation": { notFound() { throw new Error("not_found"); } },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/membership/invitation-preview": { memberInvitationPreviewSnapshot: () => ({ card: privateCard, expiresAt: "2099-01-01T00:00:00Z" }) },
    "@/components/membership/MemberInvitation": { InvitationLanding: Stub },
  });
  const params = { searchParams: Promise.resolve({ source: "ruined_direct", membership: "complimentary" }) };
  const direct = await page.default(params);
  assert.equal(direct.props.invitationSource, "ruined_direct"); assert.equal(direct.props.recipientName, "Cherry Hill");
  assert.equal(direct.props.membershipType, "standard"); assert.equal(direct.props.preview, true);
  mode = "connected"; await assert.rejects(page.default(params), /not_found/);
});
