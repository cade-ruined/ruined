import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import nextConfig from "../next.config.mjs";

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
const cardModel = await load("src/lib/membership/public-card-model.ts");
const model = await load("src/lib/membership/invitation-model.ts");
const expiry = await load("src/lib/membership/invitation-expiry.ts");
const expiresAt = "2099-09-20T02:45:00.000Z";
const token = "I".repeat(43);
const card = model.invitationCard("Chosen <name>", "public-invitation-wear");
const snapshot = { card, expiresAt: null, enabled: false, eligible: false, writable: true, url: null, joinedCount: 17, version: 2 };
const notFound = () => { throw Object.assign(new Error("Not found"), { status: 404 }); };
const redirect = href => { throw Object.assign(new Error("Redirect"), { href }); };
const renderInvitation = ({ card: value, children }) => React.createElement("article", null, value.name, children);
const renderWaitlist = props => React.createElement("form", { "data-invitation-token": props.invitationToken });
const link = ({ children, ...props }) => React.createElement("a", props, children);
const params = value => ({ params: Promise.resolve({ token: value }) });
const descendants = element => React.isValidElement(element)
  ? [element, ...React.Children.toArray(element.props.children).flatMap(descendants)] : [];
const textContent = element => typeof element === "string" || typeof element === "number" ? String(element)
  : React.isValidElement(element) ? React.Children.toArray(element.props.children).map(textContent).join("") : "";

async function publicRoute(read) {
  return load("app/invitation/[token]/page.tsx", {
    "next/navigation": { notFound },
    "@/components/membership/MemberInvitation": { InvitationLanding: renderInvitation },
    "@/lib/membership/invitation-repository": { getPublicMemberInvitation: read },
    "@/lib/membership/invitation-model": model,
    "@/lib/membership/public-card-model": cardModel,
  });
}

test("invalid and revoked invitations reveal no member details or sample content", async () => {
  let reads = 0;
  const page = await publicRoute(async () => { reads++; return null; });
  assert.equal(page.dynamic, "force-dynamic"); assert.equal(page.revalidate, 0);
  for (const invalid of ["preview", "../my", "member:123", "I".repeat(42)]) {
    assert.equal((await page.generateMetadata(params(invalid))).title, "Invitation unavailable");
    await assert.rejects(page.default(params(invalid)), { status: 404 });
  }
  assert.equal(reads, 0, "malformed tokens must not reach membership queries");
  const metadata = await page.generateMetadata(params(token));
  assert.equal(metadata.title, "Invitation unavailable");
  assert.deepEqual(metadata.openGraph.images, []); assert.deepEqual(metadata.twitter.images, []);
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(metadata.referrer, "no-referrer"); assert.equal(metadata.alternates.canonical, null);
  assert.doesNotMatch(JSON.stringify(metadata), /Chosen|joinedCount|memberId|personId|public-invitation-wear/);
  await assert.rejects(page.default(params(token)), { status: 404 });
});

test("public invitation routes pass the card and token without the owner's private count or identity", async () => {
  let current = { card, expiresAt, joinedCount: 7391, personId: "PRIVATE PERSON", email: "PRIVATE EMAIL" };
  const page = await publicRoute(async value => { assert.equal(value, token); return current; });
  const rendered = await page.default(params(token));
  assert.deepEqual(Object.keys(rendered.props).sort(), ["card", "expiresAt", "token"]);
  assert.equal(rendered.props.expiresAt, expiresAt); assert.deepEqual(rendered.props.card, card); assert.equal(rendered.props.token, token);
  assert.match(renderToStaticMarkup(rendered), /Chosen &lt;name&gt;/);
  assert.doesNotMatch(JSON.stringify(rendered.props), /7391|PRIVATE|joinedCount|personId|email/);
  const metadata = await page.generateMetadata(params(token));
  assert.match(metadata.title, /Chosen <name>/);
  assert.doesNotMatch(JSON.stringify(metadata), /7391|PRIVATE|joinedCount|personId|email|public-invitation-wear/);
  assert.deepEqual(metadata.openGraph.images, []); assert.deepEqual(metadata.twitter.images, []);
  current = null;
  await assert.rejects(page.default(params(token)), { status: 404 });
  assert.equal((await page.generateMetadata(params(token))).title, "Invitation unavailable");
});

test("owner invitation route checks authentication and never substitutes samples after a failure", async () => {
  let mode = "connected", viewer = null, failure = null, sampleCalls = 0, reads = 0;
  const owner = () => null, unavailable = () => null;
  const page = await load("app/my/invitation/page.tsx", {
    "next/navigation": { redirect },
    "@/components/membership/MemberInvitation": owner,
    "@/components/platform/PlatformUnavailable": unavailable,
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/membership/invitation-repository": { getOwnMemberInvitation: async id => {
      reads++; assert.equal(id, "verified-user"); if (failure) throw failure; return snapshot;
    } },
    "@/lib/membership/invitation-model": model,
    "@/lib/membership/public-card-model": cardModel,
    "@/lib/membership/invitation-preview": { memberInvitationPreviewSnapshot: () => { sampleCalls++; return { ...snapshot, writable: false, joinedCount: 0 }; } },
  });
  await assert.rejects(page.default(), { href: "/my/access" });
  assert.equal(reads, 0); assert.equal(sampleCalls, 0);
  viewer = { authUserId: "verified-user" };
  const ineligible = await page.default();
  assert.equal(ineligible.type, owner); assert.equal(ineligible.props.initialSnapshot, snapshot);
  assert.equal(ineligible.props.initialSnapshot.eligible, false, "ineligible members can inspect the disabled owner view");
  failure = new Error("PRIVATE DATABASE ERROR");
  const failed = await page.default();
  assert.equal(failed.type, owner); assert.equal(failed.props.initialSnapshot, null);
  assert.doesNotMatch(JSON.stringify(failed.props), /PRIVATE|Chosen/); assert.equal(sampleCalls, 0);
  failure = new model.MemberInvitationError(403, "PRIVATE ACCESS DETAIL");
  const denied = await page.default();
  assert.equal(denied.type, unavailable); assert.equal(denied.props.reason, "member_access");
  mode = "unavailable";
  assert.equal((await page.default()).props.accessHref, "/my/access"); assert.equal(sampleCalls, 0);
  mode = "preview";
  const preview = await page.default();
  assert.equal(preview.props.preview, true); assert.equal(preview.props.initialSnapshot.writable, false);
  assert.equal(preview.props.initialSnapshot.joinedCount, 0); assert.equal(sampleCalls, 1);
});

test("invitation preview routes stay unavailable in production even with preview mode requested", async () => {
  const keys = ["NODE_ENV", "PLATFORM_MODE", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const configuration = await load("src/lib/platform/config.ts", { "server-only": {} });
    let samples = 0;
    const page = await load("app/invitation/preview/page.tsx", {
      "next/navigation": { notFound }, "@/lib/platform/config": configuration,
      "@/lib/membership/invitation-preview": { memberInvitationPreviewSnapshot: () => { samples++; return snapshot; } },
      "@/components/membership/MemberInvitation": { InvitationLanding: renderInvitation },
    });
    process.env.NODE_ENV = "production"; process.env.PLATFORM_MODE = "preview";
    for (const key of keys.slice(2)) delete process.env[key];
    assert.throws(() => page.default(), { status: 404 });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test"; process.env.DATABASE_URL = "test";
    assert.throws(() => page.default(), { status: 404 }); assert.equal(samples, 0);
    process.env.NODE_ENV = "development";
    assert.equal(page.default().props.preview, true); assert.equal(samples, 1);
  } finally {
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; }
  }
});

test("public landing offers the attributed waitlist without owner controls or joined counts", async () => {
  const invitation = await load("src/components/membership/MemberInvitation.tsx", {
    react: React, "next/link": link,
    "@/components/public-members/MembershipWaitlistForm": renderWaitlist,
    "./card/PublicMemberCardPage": renderInvitation,
    "@/lib/membership/invitation-expiry": expiry,
    "./use-invitation-expiry": { useInvitationExpired: value => expiry.memberInvitationExpired(value) },
  });
  const landing = invitation.InvitationLanding({ card, token, expiresAt });
  assert.equal(landing.props.variant, "invitation");
  const waitlist = descendants(landing).find(item => item.type === renderWaitlist);
  assert.deepEqual(waitlist.props, { invitationToken: token, disabled: false });
  const html = renderToStaticMarkup(landing);
  assert.match(html, /Chosen &lt;name&gt;/); assert.match(html, /Find your people/);
  assert.doesNotMatch(html, /joined through|completed memberships|Copy link|Turn off invitation|joinedCount|7391/);
  const preview = invitation.InvitationLanding({ card, expiresAt, preview: true });
  assert.equal(descendants(preview).some(item => item.type === renderWaitlist), false, "sample invitations cannot submit attributed joins");
});

test("ineligible, read-only and preview owner views cannot enable invitation sharing", async () => {
  const invitation = await load("src/components/membership/MemberInvitation.tsx", {
    react: { ...React, useState: initial => [initial, () => {}], useEffect: () => {} },
    "next/link": link,
    "@/components/public-members/MembershipWaitlistForm": renderWaitlist,
    "./card/PublicMemberCardPage": renderInvitation,
    "@/lib/membership/invitation-expiry": expiry,
    "./use-invitation-expiry": { useInvitationExpired: value => expiry.memberInvitationExpired(value) },
  });
  for (const input of [
    { initialSnapshot: snapshot },
    { initialSnapshot: { ...snapshot, eligible: true, writable: false } },
    { initialSnapshot: { ...snapshot, eligible: true }, preview: true },
  ]) {
    const rendered = invitation.default(input);
    const enable = descendants(rendered).find(item => item.type === "button" && /Create my invitation/.test(textContent(item)));
    assert.ok(enable); assert.equal(enable.props.disabled, true);
    assert.doesNotMatch(renderToStaticMarkup(rendered), /data-invitation-token/);
  }
  const loading = invitation.default({ initialSnapshot: null });
  assert.match(renderToStaticMarkup(loading), /Preparing your invitation/);
  assert.doesNotMatch(renderToStaticMarkup(loading), /Chosen|public-invitation-wear|joined through/);
});

test("expired public and owner views stop new use while retaining the original deadline and referral count", async () => {
  const invitation = await load("src/components/membership/MemberInvitation.tsx", {
    react: { ...React, useState: initial => [initial, () => {}], useEffect: () => {} }, "next/link": link,
    "@/components/public-members/MembershipWaitlistForm": renderWaitlist,
    "./card/PublicMemberCardPage": renderInvitation,
    "@/lib/membership/invitation-expiry": expiry,
    "./use-invitation-expiry": { useInvitationExpired: value => expiry.memberInvitationExpired(value) },
  });
  const elapsed = "2000-01-01T00:00:00.000Z";
  const publicPage = invitation.InvitationLanding({ card, token, expiresAt: elapsed });
  assert.equal(publicPage.props.invitationExpiresAt, elapsed);
  assert.equal(descendants(publicPage).find(item => item.type === renderWaitlist).props.disabled, true);
  assert.match(renderToStaticMarkup(publicPage), /This invitation has expired/);
  const owner = invitation.default({ initialSnapshot: { ...snapshot, enabled: true, eligible: true, expiresAt: elapsed, url: `/invitation/${token}` } });
  assert.equal(owner.props.invitationExpiresAt, elapsed);
  const html = renderToStaticMarkup(owner);
  assert.match(html, /Create new invitation/); assert.match(html, /17/);
  assert.doesNotMatch(html, /Copy link|Share invitation|Your invitation link/);
});

test("copying never renews an invitation and explicit renewal sends no caller-selected date or token", async () => {
  const calls = [], copied = [];
  const active = { ...snapshot, enabled: true, eligible: true, expiresAt, url: `/invitation/${token}` };
  const invitation = await load("src/components/membership/MemberInvitation.tsx", {
    react: { ...React, useState: initial => [initial, () => {}], useEffect: () => {} }, "next/link": link,
    "@/components/public-members/MembershipWaitlistForm": renderWaitlist,
    "./card/PublicMemberCardPage": renderInvitation,
    "@/lib/membership/invitation-expiry": expiry,
    "./use-invitation-expiry": { useInvitationExpired: value => expiry.memberInvitationExpired(value) },
  }, {
    window: { location: { origin: "https://members.example.test" } },
    navigator: { clipboard: { writeText: async value => copied.push(value) } },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ snapshot: active }) }; },
  });
  const rendered = invitation.default({ initialSnapshot: active });
  descendants(rendered).find(item => item.type === "button" && textContent(item) === "Copy link").props.onClick();
  await Promise.resolve();
  assert.deepEqual(copied, [`https://members.example.test/invitation/${token}`]); assert.equal(calls.length, 0);
  descendants(rendered).find(item => item.type === "button" && textContent(item) === "Create a new 48-hour invitation").props.onClick();
  await Promise.resolve();
  assert.deepEqual(calls, [{ url: "/api/my/invitation", body: { enabled: true, version: active.version, renew: true } }]);
});

test("invitation waitlist submission adds only its opaque token and keeps ordinary submissions unchanged", async () => {
  const values = { name: "Test Person", email: "test@example.test", phone: "", website: "" };
  for (const props of [{}, { invitationToken: token }, { invitationToken: token, disabled: true }]) {
    const calls = []; let resets = 0;
    const form = await load("src/components/public-members/MembershipWaitlistForm.tsx", {
      react: { ...React, useId: () => "invitation-form", useRef: initial => ({ current: initial }), useState: initial => [initial, () => {}] },
    }, {
      FormData: class { get(name) { return values[name] ?? null; } },
      fetch: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) }; },
    });
    const rendered = form.default(props);
    const elements = descendants(rendered), inputs = elements.filter(item => item.type === "input");
    assert.deepEqual(inputs.map(item => item.props.name).sort(), ["email", "name", "phone", "website"]);
    assert.equal(inputs.find(item => item.props.name === "phone").props.required, undefined);
    assert.equal(inputs.find(item => item.props.name === "website").props.tabIndex, -1);
    assert.equal(elements.find(item => item.type === "fieldset").props.disabled, Boolean(props.disabled));
    await rendered.props.onSubmit({ preventDefault() {}, currentTarget: { reset() { resets++; } } });
    if (props.disabled) { assert.equal(calls.length, 0); assert.equal(resets, 0); continue; }
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/members/waitlist"); assert.equal(calls[0].method, "POST");
    assert.deepEqual(calls[0].body, props.invitationToken ? { invitationToken: token, ...values } : values);
    assert.doesNotMatch(JSON.stringify(calls[0].body), /joinedCount|memberId|personId|inviterName/); assert.equal(resets, 1);
  }
});

test("invitation failures render a generic retry boundary without leaking database details", async () => {
  const failure = new Error(`PRIVATE DATABASE /invitation/${token}`);
  const page = await publicRoute(async () => { throw failure; });
  await assert.rejects(page.default(params(token)), error => error === failure);
  await assert.rejects(page.generateMetadata(params(token)), error => error === failure);
  const boundary = await load("app/invitation/error.tsx");
  let retries = 0;
  const rendered = boundary.default({ error: failure, reset: () => { retries++; } });
  assert.doesNotMatch(renderToStaticMarkup(rendered), /PRIVATE|Chosen|public-invitation-wear/);
  descendants(rendered).find(item => item.type === "button").props.onClick(); assert.equal(retries, 1);
});

test("public invitation tokens are protected from caching, indexing and outgoing referrers", async () => {
  const rules = await nextConfig.headers();
  const index = rules.findIndex(rule => rule.source === "/invitation/:path*");
  assert.ok(index > rules.findIndex(rule => rule.source === "/(.*)"));
  const headers = Object.fromEntries(rules[index].headers.map(header => [header.key, header.value]));
  assert.match(headers["Cache-Control"], /private, no-store/);
  assert.equal(headers["X-Robots-Tag"], "noindex, nofollow"); assert.equal(headers["Referrer-Policy"], "no-referrer");
});
