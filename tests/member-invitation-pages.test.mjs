import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import sharp from "sharp";
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
const presentation = await load("src/lib/membership/personal-invitation-presentation.ts");
const expiresAt = "2099-09-20T02:45:00.000Z";
const token = "I".repeat(43);
const card = model.invitationCard("Chosen <name>", "public-invitation-wear");
const snapshot = { card, expiresAt: null, enabled: false, eligible: false, writable: true, url: null, joinedCount: 17, version: 2 };
const notFound = () => { throw Object.assign(new Error("Not found"), { status: 404 }); };
const redirect = href => { throw Object.assign(new Error("Redirect"), { href }); };
const renderInvitation = ({ card: value, children }) => React.createElement("article", null, value.name, children);
const renderAcceptance = props => React.createElement("form", { "data-personal-invitation": props.invitationToken });
const renderWaitlist = props => React.createElement("form", { "data-invitation-token": props.invitationToken });
const link = ({ children, ...props }) => React.createElement("a", props, children);
const params = value => ({ params: Promise.resolve({ token: value }) });
const descendants = element => React.isValidElement(element)
  ? [element, ...React.Children.toArray(element.props.children).flatMap(descendants)] : [];


async function publicRoute(read) {
  return load("app/invitation/[token]/page.tsx", {
    react: { ...React, cache: fn => fn },
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
  assert.deepEqual(metadata.openGraph.videos, []);
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(metadata.referrer, "no-referrer"); assert.equal(metadata.alternates.canonical, null);
  assert.doesNotMatch(JSON.stringify(metadata), /Chosen|joinedCount|memberId|personId|public-invitation-wear/);
  await assert.rejects(page.default(params(token)), { status: 404 });
});

test("public invitation routes pass the card and token without the owner's private count or identity", async () => {
  let current = { card, expiresAt, membershipType: "complimentary", complimentaryEndsAt: "2099-12-31T06:59:59.999Z", complimentaryReason: "PRIVATE REASON", complimentaryAuthorizedByAuthUserId: "PRIVATE ACTOR", joinedCount: 7391, personId: "PRIVATE PERSON", email: "PRIVATE EMAIL" };
  const page = await publicRoute(async value => { assert.equal(value, token); return current; });
  const rendered = await page.default(params(token));
  assert.deepEqual(Object.keys(rendered.props).sort(), ["card", "complimentaryEndsAt", "expiresAt", "membershipType", "token"]);
  assert.equal(rendered.props.membershipType, "complimentary"); assert.equal(rendered.props.complimentaryEndsAt, current.complimentaryEndsAt);
  assert.equal(rendered.props.expiresAt, expiresAt); assert.deepEqual(rendered.props.card, card); assert.equal(rendered.props.token, token);
  assert.match(renderToStaticMarkup(rendered), /Chosen &lt;name&gt;/);
  assert.doesNotMatch(JSON.stringify(rendered.props), /7391|PRIVATE|joinedCount|personId|email/);
  const metadata = await page.generateMetadata(params(token));
  assert.match(metadata.title, /Chosen <name>/);
  assert.doesNotMatch(JSON.stringify(metadata), /7391|PRIVATE|joinedCount|personId|email|public-invitation-wear/);
  const poster = metadata.openGraph.images[0];
  const video = metadata.openGraph.videos[0];
  assert.equal(poster.url, "https://members.theruinedproject.com/membership/card/share/invitation-spin-v1.jpg");
  assert.equal(video.url, "https://members.theruinedproject.com/membership/card/share/invitation-spin-v1.mp4");
  assert.equal(video.secureUrl, video.url); assert.equal(video.type, "video/mp4");
  assert.equal(poster.type, "image/jpeg"); assert.ok(poster.width >= 900);
  assert.equal(video.width, poster.width); assert.equal(video.height, poster.height);
  assert.deepEqual(metadata.twitter.images, [poster]); assert.equal(metadata.twitter.card, "summary_large_image");
  assert.equal(metadata.openGraph.url, `https://members.theruinedproject.com/invitation/${token}`);
  assert.doesNotMatch(JSON.stringify([poster, video]), /Chosen|public-invitation-wear|expiresAt|2099|IIII/,
    "cacheable share media must contain no invitation-specific data");
  current = null;
  await assert.rejects(page.default(params(token)), { status: 404 });
  const unavailable = await page.generateMetadata(params(token));
  assert.equal(unavailable.title, "Invitation unavailable");
  assert.deepEqual(unavailable.openGraph.images, []); assert.deepEqual(unavailable.openGraph.videos, []);
  assert.deepEqual(unavailable.twitter.images, []); assert.equal(unavailable.openGraph.url, undefined);
});

test("owner invitation route checks authentication and never substitutes samples after a failure", async () => {
  let mode = "connected", viewer = null, failure = null, sampleCalls = 0, reads = 0;
  const owner = () => null, unavailable = () => null;
  const ownerSnapshot = { ...snapshot, invitations: [], counts: { created: 0, active: 0, expired: 0, accepted: 0, submitted: 0, joined: 17 }, emailReady: false };
  const page = await load("app/my/invitation/page.tsx", {
    "next/navigation": { redirect },
    "@/components/membership/MemberInvitation": owner,
    "@/components/platform/PlatformUnavailable": unavailable,
    "@/lib/auth/session": { resolveCurrentPlatformSession: async () => viewer ? { status: "authenticated", viewer } : { status: "signed_out" } },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/membership/personal-invitation-repository": { getOwnPersonalInvitations: async id => {
      reads++; assert.equal(id, "verified-user"); if (failure) throw failure; return ownerSnapshot;
    } },
    "@/lib/membership/invitation-model": model,
    "@/lib/membership/personal-invitation-delivery": { getPersonalInvitationEmailReady: () => false },
    "@/lib/membership/public-card-model": cardModel,
    "@/lib/membership/personal-invitation-preview": { personalInvitationPreviewSnapshot: () => { sampleCalls++; return { ...ownerSnapshot, writable: false, counts: { created: 3, active: 1, expired: 1, accepted: 1, submitted: 1, joined: 1 } }; } },
  });
  await assert.rejects(page.default({}), { href: "/my/access" });
  assert.equal(reads, 0); assert.equal(sampleCalls, 0);
  viewer = { authUserId: "verified-user" };
  const ineligible = await page.default({});
  assert.equal(ineligible.type, owner); assert.deepEqual(ineligible.props.initialSnapshot, ownerSnapshot);
  assert.equal(ineligible.props.initialSnapshot.eligible, false, "ineligible members can inspect the disabled owner view");
  failure = new Error("PRIVATE DATABASE ERROR");
  const failed = await page.default({});
  assert.equal(failed.type, owner); assert.equal(failed.props.initialSnapshot, null);
  assert.doesNotMatch(JSON.stringify(failed.props), /PRIVATE|Chosen/); assert.equal(sampleCalls, 0);
  failure = new model.MemberInvitationError(403, "PRIVATE ACCESS DETAIL");
  const denied = await page.default({});
  assert.equal(denied.type, unavailable); assert.equal(denied.props.reason, "member_access");
  mode = "unavailable";
  assert.equal((await page.default({})).props.accessHref, "/my/access"); assert.equal(sampleCalls, 0);
  mode = "preview";
  const preview = await page.default({});
  assert.equal(preview.props.preview, true); assert.equal(preview.props.initialSnapshot.writable, false);
  assert.equal(preview.props.initialSnapshot.counts.joined, 1); assert.equal(sampleCalls, 1);
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
    await assert.rejects(page.default({}), { status: 404 });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test"; process.env.DATABASE_URL = "test";
    await assert.rejects(page.default({}), { status: 404 }); assert.equal(samples, 0);
    process.env.NODE_ENV = "development";
    assert.equal((await page.default({})).props.preview, true); assert.equal(samples, 1);
    const complimentary = await page.default({ searchParams: Promise.resolve({ membership: "complimentary" }) });
    assert.equal(complimentary.props.membershipType, "complimentary"); assert.equal(complimentary.props.preview, true);
  } finally {
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; }
  }
});

test("public landing offers the attributed waitlist without owner controls or joined counts", async () => {
  const invitation = await load("src/components/membership/MemberInvitation.tsx", {
    react: React, "next/link": link,
    "@/components/public-members/MembershipWaitlistForm": renderWaitlist,
    "./PersonalInvitationAcceptance": renderAcceptance,
    "./card/PublicMemberCardPage": renderInvitation,
    "@/lib/membership/invitation-expiry": expiry,
    "@/lib/membership/personal-invitation-presentation": presentation,
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


test("expired public views stop new use while retaining the original deadline", async () => {
  const invitation = await load("src/components/membership/MemberInvitation.tsx", {
    react: { ...React, useState: initial => [initial, () => {}], useEffect: () => {} }, "next/link": link,
    "@/components/public-members/MembershipWaitlistForm": renderWaitlist,
    "./PersonalInvitationAcceptance": renderAcceptance,
    "./card/PublicMemberCardPage": renderInvitation,
    "@/lib/membership/invitation-expiry": expiry,
    "@/lib/membership/personal-invitation-presentation": presentation,
    "./use-invitation-expiry": { useInvitationExpired: value => expiry.memberInvitationExpired(value) },
  });
  const elapsed = "2000-01-01T00:00:00.000Z";
  const publicPage = invitation.InvitationLanding({ card, token, expiresAt: elapsed });
  assert.equal(publicPage.props.invitationExpiresAt, elapsed);
  assert.equal(descendants(publicPage).find(item => item.type === renderWaitlist).props.disabled, true);
  assert.match(renderToStaticMarkup(publicPage), /This invitation has expired/);
});

test("personal landings route directly to email acceptance while legacy invitations keep the waitlist", async () => {
  const invitation = await load("src/components/membership/MemberInvitation.tsx", {
    react: React, "next/link": link,
    "@/components/public-members/MembershipWaitlistForm": renderWaitlist,
    "./PersonalInvitationAcceptance": renderAcceptance,
    "./card/PublicMemberCardPage": renderInvitation,
    "@/lib/membership/invitation-expiry": expiry,
    "@/lib/membership/personal-invitation-presentation": presentation,
    "./use-invitation-expiry": { useInvitationExpired: value => expiry.memberInvitationExpired(value) },
  });
  for (const preview of [false, true]) {
    const landing = invitation.InvitationLanding({ card, token, expiresAt, recipientName: "Alex Rivera", preview });
    const elements = descendants(landing);
    assert.equal(elements.some(element => element.type === renderWaitlist), false);
    const acceptance = elements.find(element => element.type === renderAcceptance);
    assert.deepEqual(acceptance.props, { invitationToken: token, recipientName: "Alex Rivera", inviterName: card.name, invitationSource: "member", expiresAt, membershipType: "standard", complimentaryEndsAt: null, preview });
    assert.doesNotMatch(JSON.stringify(acceptance.props), /recipientEmail|personId|joinedCount/);
    if (!preview) assert.match(renderToStaticMarkup(landing.props.headerActions), /Accept invitation/);
  }
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

test("invitation preview media is decodable, lightweight, and ready for inline video playback", async () => {
  const page = await publicRoute(async () => ({ card, expiresAt }));
  const metadata = await page.generateMetadata(params(token));
  const poster = metadata.openGraph.images[0], video = metadata.openGraph.videos[0];
  const bytes = await Promise.all([poster.url, video.url, video.url.replace(/\.mp4$/, ".gif")].map(url =>
    readFile(new URL(`../public${new URL(url).pathname}`, import.meta.url))));
  assert.ok(bytes.reduce((total, file) => total + file.length, 0) < 9_500_000,
    "leave room for icons under Messages' 10 MB total resource limit");
  const image = await sharp(bytes[0]).metadata();
  assert.equal(image.format, "jpeg"); assert.equal(image.width, poster.width); assert.equal(image.height, poster.height);
  const gif = await sharp(bytes[2], { animated: true }).metadata();
  assert.equal(gif.format, "gif"); assert.ok(gif.pages > 1); assert.equal(gif.loop, 0);
  assert.equal(bytes[1].toString("ascii", 4, 8), "ftyp");
  const movie = bytes[1].indexOf(Buffer.from("moov")), data = bytes[1].indexOf(Buffer.from("mdat"));
  assert.ok(movie > 0 && movie < data, "MP4 movie metadata must precede video data for quick playback");
});
