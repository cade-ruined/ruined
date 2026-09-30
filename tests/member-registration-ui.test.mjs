import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const Stub = () => null;
const Link = ({ children, ...props }) => React.createElement("a", props, children);
const Image = ({ fill, priority, ...props }) => { void fill; void priority; return React.createElement("img", props); };
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const redirect = href => { throw Object.assign(Error("redirect"), { href }); };
async function load(path, deps = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), js)(name => name in deps ? deps[name] : require(name), loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const registration = changes => ({ memberId: "test-member", state: "collecting", registeredAt: null, profileActivatedAt: null, requiresPaymentMethod: true, profileComplete: false, ready: changes?.state === "registered", version: 1, ...changes });
const onboarding = changes => ({ state: "in_progress", billingState: "pending", membershipFunding: "self", requiredFieldsComplete: false, email: "new@example.test", agreement: { acceptanceId: null, id: null, body: null }, profile: {}, ...changes });
const context = (changes = {}) => ({ state: "authenticated", viewer: { authUserId: "test-auth", email: "new@example.test" }, data: onboarding(), configuration: { mode: "connected", stripeCheckoutReady: true, stripePaymentSetupReady: true, minimumAge: 18 }, ...changes });
const previewDeps = { MEMBER_PREVIEW_COOKIE: "fixture", memberPreviewScenario: value => value, memberRegistrationPreview: value => value === "registered" ? registration({ state: "registered", profileComplete: true }) : registration() };

async function pageFixture(path, initialRegistration, initialContext = context()) {
  let currentRegistration = initialRegistration, currentContext = initialContext;
  const Form = () => null, Payment = () => null, Receipt = () => null, Progress = () => null;
  const page = (await load(path, {
    "next/image": Image, "next/link": Link, "next/navigation": { redirect },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "registration-info" }) }) },
    "@/components/membership/JoinForm": Form, "@/components/membership/MemberPaymentMethod": Payment,
    "@/components/membership/MemberRegistrationReceipt": Receipt,
    "@/components/membership/MemberSettingsHeader": Stub, "@/components/platform/PlatformUnavailable": Stub,
    "@/components/membership/MembershipEntryProgress": { MembershipEntryProgress: Progress, MembershipEntryProgressProvider: Stub },
    "@/lib/membership/page-context": { getMembershipPageContext: async (preview, loader, area) => {
      if (area === "registration") return { ...currentContext, data: currentContext.state === "preview" ? preview : { registration: currentRegistration } };
      return currentContext;
    } },
    "@/lib/membership/registration-repository": { getMemberRegistration: async () => currentRegistration },
    "@/lib/membership/preview-scenarios": previewDeps,
    "@/lib/membership/repository": { getMemberOnboarding: () => assert.fail("No live database reads") },
    "@/lib/membership/preview": { PREVIEW_MEMBER_ONBOARDING: {} },
    "@/lib/membership/entry-stage": await load("src/lib/membership/entry-stage.ts"),
    "@/lib/membership/public-signup-admission": { getMemberSignupPlan: async () => "monthly" },
    "@/lib/membership/photos": { isMemberPhotoStorageConfigured: () => false },
    "@/lib/platform/config": { getStripePublishableKey: () => null },
  })).default;
  return { page: () => page({ searchParams: Promise.resolve({}) }), Form, Payment, Receipt, Progress,
    setRegistration: value => { currentRegistration = value; }, setContext: value => { currentContext = value; } };
}

test("held join ignores live checkout availability and offers registration details without agreement progress", async () => {
  const f = await pageFixture("app/my/join/page.tsx", registration());
  const tree = await f.page(), form = nodes(tree).find(node => node.type === f.Form);
  assert.equal(form.props.registrationOnly, true);
  assert.equal(form.props.checkoutEnabled, false);
  assert.equal(form.props.registrationRequiresPaymentMethod, true);
  assert.equal(nodes(tree).some(node => node.type === f.Progress), false);
  f.setRegistration(registration({ requiresPaymentMethod: false }));
  assert.equal(nodes(await f.page()).find(node => node.type === f.Form).props.registrationRequiresPaymentMethod, false);
});

test("returning registrations resume card or receipt while existing activated accounts keep home access", async () => {
  const f = await pageFixture("app/my/join/page.tsx", registration({ profileComplete: true }));
  await assert.rejects(f.page, error => error.href === "/my/payment-method");
  f.setRegistration(registration({ state: "registered", profileComplete: true }));
  await assert.rejects(f.page, error => error.href === "/my/registered");
  f.setRegistration(null); f.setContext(context({ data: onboarding({ state: "completed", billingState: "active" }) }));
  await assert.rejects(f.page, error => error.href === "/my");
});

test("card page sends incomplete details back to entry and exempts complimentary registration", async () => {
  const f = await pageFixture("app/my/payment-method/page.tsx", registration());
  await assert.rejects(f.page, error => error.href === "/my/join");
  f.setRegistration(registration({ profileComplete: true, requiresPaymentMethod: false }));
  await assert.rejects(f.page, error => error.href === "/my/registered");
  f.setRegistration(registration({ profileComplete: true }));
  f.setContext(context({ data: onboarding({ requiredFieldsComplete: true }) }));
  const tree = await f.page();
  assert.equal(nodes(tree).find(node => node.type === f.Payment).props.registrationOnly, true);
  assert.equal(nodes(tree).some(node => node.props.href === "/my"), false);
});

test("receipt requires registered server state and cannot grant access from a URL", async () => {
  const f = await pageFixture("app/my/registered/page.tsx", registration());
  await assert.rejects(f.page, error => error.href === "/my/join");
  f.setRegistration(registration({ profileComplete: true }));
  await assert.rejects(f.page, error => error.href === "/my/payment-method");
  f.setRegistration(registration({ state: "registered", profileComplete: true }));
  const tree = await f.page();
  assert.equal(tree.type, f.Receipt); assert.equal(tree.props.email, "new@example.test"); assert.equal(tree.props.preview, false);
  f.setRegistration(registration({ state: "registered", profileComplete: true, ready: false }));
  await assert.rejects(f.page, error => error.href === "/my/payment-method");
  f.setRegistration(registration({ state: "activated", profileComplete: true }));
  await assert.rejects(f.page, error => error.href === "/my");
  f.setContext(context({ state: "signed_out", viewer: null }));
  await assert.rejects(f.page, error => error.href === "/my/access");
});

test("receipt preview is inert and does not require an account", async () => {
  const f = await pageFixture("app/my/registered/page.tsx", null, context({ state: "preview", viewer: null }));
  const tree = await f.page(); assert.equal(tree.type, f.Receipt); assert.equal(tree.props.preview, true); assert.equal(tree.props.email, "you@example.com");
});

function hookFixture() {
  let cursor = 0; const slots = [];
  return { react: { ...React, useEffect() {},
    useRef(value) { const slot = cursor++; return slots[slot] ??= { current: value }; },
    useState(value) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof value === "function" ? value() : value; return [slots[slot], next => { slots[slot] = typeof next === "function" ? next(slots[slot]) : next; }]; },
  }, render(Component, props) { cursor = 0; return Component(props); } };
}

async function detailsFixture(requiresPaymentMethod) {
  const h = hookFixture(), calls = [], redirects = [];
  let ok = true;
  const values = { "member-tag": "new_member", "mobile-country": "US", "mobile-national": "8015550123", "legal-name": "New Member", "birth-date": "1990-01-01", "apparel-size": "M", "address-line-1": "123 Main", city: "Provo", region: "UT", "postal-code": "84601", "country-code": "US" };
  const Form = (await load("src/components/membership/JoinForm.tsx", {
    react: h.react, "next/link": Link, "@stripe/stripe-js": { loadStripe: () => assert.fail("No checkout") },
    "@/components/membership/MembershipEntryProgress": { useMembershipEntryProgressStage() {} },
    "@/components/membership/CoupleMembershipApproval": Stub, "@/components/membership/AgreementText": Stub,
    "@/components/membership/MemberPhotoUpload": Stub, "@/components/membership/MemberPaymentMethod": Stub,
    "@/lib/membership/entry-stage": await load("src/lib/membership/entry-stage.ts"),
    "@/lib/membership/pricing": await load("src/lib/membership/pricing.ts"),
    "@/lib/membership/phone": await load("src/lib/membership/phone.ts"),
  }, {
    FormData: class { get(key) { return values[key] ?? ""; } },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok, json: async () => ok ? { onboarding: onboarding({ requiredFieldsComplete: true }) } : { error: "Try again." } }; },
    window: { location: { assign: url => redirects.push(url) } },
  })).default;
  const props = { enabled: true, checkoutEnabled: false, disabledReason: null, checkoutDisabledReason: null, initialOnboarding: onboarding(), minimumAge: 18, photoStorageReady: false, publishableKey: null, registrationOnly: true, registrationRequiresPaymentMethod: requiresPaymentMethod };
  const render = () => h.render(Form, props);
  return { calls, redirects, render, fail: () => { ok = false; }, submit: () => nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: {} }) };
}

test("details save follows server confirmation to required card or complimentary receipt without activating membership", async () => {
  for (const required of [true, false]) {
    const f = await detailsFixture(required);
    const markup = renderToStaticMarkup(f.render());
    assert.doesNotMatch(markup, /Profile photo|public profile|Save my profile|Review agreement/);
    assert.match(markup, /Your details|Reserve your unique/);
    await f.submit();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, "/api/my/onboarding"); assert.equal(f.calls[0].body.action, "save_profile");
    assert.deepEqual(f.redirects, [required ? "/my/payment-method" : "/my/registered"]);
  }
  const f = await detailsFixture(true); f.fail(); await f.submit();
  assert.deepEqual(f.redirects, []); assert.match(renderToStaticMarkup(f.render()), /Try again/);
});

test("held shell omits member navigation, settings, updates and badge entry points while keeping support and sign-out", async () => {
  const Shell = (await load("src/components/membership/MemberJourneyShell.tsx", {
    "next/image": Image, "next/link": Link, "next/navigation": { usePathname: () => "/my/payment-method" },
    "@/components/platform/MemberNavigationFab": () => React.createElement("span", null, "PRIVATE MENU"),
    "@/components/membership/MemberIcon": Stub, "@/components/membership/InstallRuined": Stub,
    "@/lib/membership/navigation": await load("src/lib/membership/navigation.ts"),
    "@/lib/site": { publicWebsiteHref: path => `https://theruinedproject.com${path}` },
    "@/styles/member-journey-pages.css": {}, "./MemberJourneyShell.module.css": {},
  })).default;
  const render = registrationOnly => renderToStaticMarkup(React.createElement(Shell, { configuration: { mode: "connected" }, viewerLabel: "new@example.test", registrationOnly }, "Content"));
  const held = render(true);
  assert.doesNotMatch(held, /PRIVATE MENU|href="\/my(?:\/|\")|Member pages|Updates/);
  assert.match(held, /mailto:connect@theruinedproject.com/); assert.match(held, /Sign out/); assert.match(held, /Dark mode/);
  assert.match(render(false), /Member pages|PRIVATE MENU/);
});

test("registration receipt preserves charge boundaries, email privacy and a visible install control", async () => {
  const Receipt = (await load("src/components/membership/MemberRegistrationReceipt.tsx", {
    "next/image": Image, "next/link": Link,
    "@/components/membership/InstallRuined": ({ variant }) => React.createElement("button", { "data-variant": variant }, "Install Ruined"),
  })).default;
  const render = requiresPaymentMethod => renderToStaticMarkup(React.createElement(Receipt, { email: "new@example.test", registeredAt: "2026-09-30T16:00:00Z", requiresPaymentMethod }));
  const html = render(true);
  assert.match(html, /You’re registered/); assert.match(html, /no subscription has started/); assert.match(html, /We’ll email/);
  assert.match(html, /Install Ruined/); assert.match(html, /data-variant="profile"/);
  assert.doesNotMatch(html, /email (sent|delivered)|href="\/my(?:\"|\/profile|\/circle|\/foundations)/i);
  assert.match(render(false), /No payment card is required/); assert.doesNotMatch(render(false), /Manage saved card|Your card is saved/);
});

test("layout withholds premature badge celebrations and fails navigation closed if registration lookup fails", async () => {
  const Session = () => null, Shell = () => null, Celebration = () => null;
  for (const value of [null, registration(), registration({ state: "registered" }), registration({ state: "activated" }), "failure"]) {
    const Layout = (await load("app/my/layout.tsx", {
      "next/navigation": { notFound: () => assert.fail("Visible member site") }, "next/headers": {},
      "@/components/membership/MemberPreviewSwitcher": Stub, "@/lib/membership/preview-scenarios": {},
      "@/components/membership/MemberJourneyShell": Shell, "@/components/membership/MemberSessionContinuity": Session,
      "@/components/membership/MemberBadgeCelebration": Celebration, "@/components/membership/MemberPortraitState": Stub,
      "@/components/membership/MemberTimelineDraftState": Stub, "@/components/membership/MemberJournalDraftState": Stub,
      "@/lib/auth/session": { resolveCurrentPlatformSession: async () => ({ status: "authenticated", viewer: { authUserId: "new-member", email: "new@example.test" } }) },
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
      "@/lib/platform/repository": { getOperatorRole: async () => null },
      "@/lib/membership/registration-repository": { getMemberRegistration: async () => { if (value === "failure") throw Error("unavailable"); return value; } },
      "@/lib/platform/visibility": { isMyRuinedVisible: () => true }, "@/lib/sharing": { privateSharingMetadata: {} },
    }, { console: { error() {} } })).default;
    const tree = await Layout({ children: "content" });
    const held = value === "failure" || Boolean(value && value.state !== "activated");
    assert.equal(nodes(tree).find(node => node.type === Shell).props.registrationOnly, held);
    assert.equal(tree.props.celebration === null, held);
  }
});
