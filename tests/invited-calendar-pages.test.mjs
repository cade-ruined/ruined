import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const Stub = () => null;
const Link = ({ children, ...props }) => React.createElement("a", props, children);
const Image = ({ fill, priority, ...props }) => { void fill; void priority; return React.createElement("img", props); };
const redirect = href => { throw Object.assign(Error("redirect"), { href }); };
const viewer = { authUserId: "verified-member", email: "member@example.test" };
class MembershipAccessDeniedError extends Error {}

function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "console", compiled)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "react/jsx-runtime" || name === "react") return require(name);
    throw Error(`Unexpected dependency: ${name}`);
  }, loaded, loaded.exports, { error() {} });
  return loaded.exports;
}

function contextFixture({ destination = "/my/registered", eligible = false, eligibilityError = false, session = "authenticated", loaderDenied = false } = {}) {
  const calls = [];
  const api = load("src/lib/membership/page-context.ts", {
    "next/headers": {}, "next/navigation": { redirect },
    "./registration-repository": { getMemberRegistrationDestination: async id => { assert.equal(id, viewer.authUserId); calls.push("registration"); return destination; } },
    "@/lib/membership/preview-scenarios": {},
    "@/lib/auth/session": { resolveCurrentPlatformSession: async () => ({ status: session, viewer }) },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/membership/repository": { MembershipAccessDeniedError },
    "@/lib/platform/experience-member-access": { hasEligibleExplicitExperienceInvitations: async id => {
      assert.equal(id, viewer.authUserId); calls.push("eligibility");
      if (eligibilityError) throw Error("database unavailable");
      return eligible;
    } },
  });
  return { calls, read: area => api.getMembershipPageContext({}, async id => {
    assert.equal(id, viewer.authUserId); calls.push("load");
    if (loaderDenied) throw new MembershipAccessDeniedError();
    return { upcoming: [{ id: "explicit-invitation" }] };
  }, area) };
}

test("held Calendar opens only for an eligible explicit invitation and keeps the repository authoritative", async () => {
  const allowed = contextFixture({ eligible: true });
  const context = await allowed.read("experiences");
  assert.equal(context.state, "authenticated");
  assert.equal(context.invitedCalendarOnly, true);
  assert.deepEqual(allowed.calls, ["registration", "eligibility", "load"]);

  const notInvited = contextFixture();
  await assert.rejects(notInvited.read("experiences"), { href: "/my/registered" });
  assert.deepEqual(notInvited.calls, ["registration", "eligibility"]);

  const denied = contextFixture({ eligible: true, loaderDenied: true });
  assert.equal((await denied.read("experiences")).state, "denied");
  const unavailable = contextFixture({ eligible: true, eligibilityError: true });
  assert.equal((await unavailable.read("experiences")).state, "unavailable");
  assert.deepEqual(unavailable.calls, ["registration", "eligibility"]);
});

test("invitations never bypass incomplete registration, billing, or other profile areas", async () => {
  for (const destination of ["/my/join", "/my/activate", "/my/payment-method"]) {
    const f = contextFixture({ destination, eligible: true });
    await assert.rejects(f.read("experiences"), { href: destination });
    assert.deepEqual(f.calls, ["registration"]);
  }
  for (const area of ["profile", "home", "circle", "foundations", "account", "journal", "timeline"]) {
    const f = contextFixture({ eligible: true });
    await assert.rejects(f.read(area), { href: "/my/registered" });
    assert.deepEqual(f.calls, ["registration"]);
  }
  const signedOut = contextFixture({ session: "signed_out", eligible: true });
  assert.equal((await signedOut.read("experiences")).state, "signed_out");
  assert.deepEqual(signedOut.calls, []);
  const active = contextFixture({ destination: null });
  assert.equal((await active.read("experiences")).invitedCalendarOnly, false);
  assert.deepEqual(active.calls, ["registration", "load"]);
});

test("held Calendar is read-only while activated member reservation controls remain available", async () => {
  const Calendar = () => null;
  for (const invitedCalendarOnly of [true, false]) {
    const Page = load("app/my/experiences/page.tsx", {
      "next/navigation": { redirect },
      "@/components/membership/MemberExperiences": Calendar,
      "@/components/membership/MemberWelcomeCalendarVisit": Stub,
      "@/components/platform/PlatformUnavailable": Stub,
      "@/lib/membership/page-context": { getMembershipPageContext: async (_preview, _load, area) => {
        assert.equal(area, "experiences");
        return { state: "authenticated", data: { upcoming: [] }, invitedCalendarOnly };
      } },
      "@/lib/membership/preview": { PREVIEW_MEMBER_EXPERIENCES: {} },
      "@/lib/membership/repository": { getMemberExperiences: Stub },
    }).default;
    const tree = await Page();
    assert.equal(tree.type, Calendar);
    assert.equal(tree.props.writable, !invitedCalendarOnly);
  }
});

test("registration receipt checks eligibility only after completed registration and passes a dedicated Calendar link", async () => {
  const Receipt = () => null;
  for (const eligible of [true, false]) {
    let checks = 0;
    const Page = load("app/my/registered/page.tsx", {
      "next/navigation": { redirect },
      "@/components/membership/MemberRegistrationReceipt": Receipt,
      "@/components/platform/PlatformUnavailable": Stub,
      "@/lib/membership/page-context": { getMembershipPageContext: async (_preview, read) => ({ state: "authenticated", configuration: {}, viewer, data: await read(viewer.authUserId) }) },
      "@/lib/membership/registration-repository": { getMemberRegistration: async () => ({ state: "registered", ready: true }) },
      "@/lib/membership/preview-scenarios": { memberRegistrationPreview: Stub },
      "@/lib/membership/registration-routing": {},
      "@/lib/platform/experience-member-access": { hasEligibleExplicitExperienceInvitations: async id => { assert.equal(id, viewer.authUserId); checks++; return eligible; } },
    }).default;
    const tree = await Page();
    assert.equal(tree.type, Receipt);
    assert.equal(tree.props.invitedCalendarAvailable, eligible);
    assert.equal(checks, 1);
  }
  const ReceiptComponent = load("src/components/membership/MemberRegistrationReceipt.tsx", {
    "next/image": Image, "next/link": Link,
    "@/components/membership/RegistrationCouplePreference": Stub,
    "@/components/membership/InstallRuined": Stub,
    "@/lib/membership/pricing": {},
    "@/lib/membership/registration-pricing-confirmation": {},
  }).default;
  for (const invitedCalendarAvailable of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(ReceiptComponent, { email: viewer.email, registeredAt: null, requiresPaymentMethod: false, invitedCalendarAvailable }));
    assert.equal(html.includes('href="/my/experiences"'), invitedCalendarAvailable);
    if (invitedCalendarAvailable) assert.match(html, /Your profile will open separately/);
    assert.doesNotMatch(html, /href="\/my(?:"|\/profile|\/circle|\/foundations)/);
  }
});

test("held navigation offers Calendar and Registration only, without exposing profile navigation", () => {
  for (const pathname of ["/my/registered", "/my/experiences"]) {
    const Shell = load("src/components/membership/MemberJourneyShell.tsx", {
      "next/image": Image, "next/link": Link, "next/navigation": { usePathname: () => pathname },
      "@/components/platform/MemberNavigationFab": () => React.createElement("span", null, "PRIVATE MENU"),
      "@/components/membership/MemberIcon": Stub, "@/components/membership/InstallRuined": Stub,
      "@/lib/membership/navigation": load("src/lib/membership/navigation.ts"),
      "@/lib/site": { publicWebsiteHref: path => `https://theruinedproject.com${path}` },
      "@/styles/member-journey-pages.css": {}, "./MemberJourneyShell.module.css": {},
    }).default;
    for (const invitedCalendarAvailable of [true, false]) {
      const html = renderToStaticMarkup(React.createElement(Shell, { configuration: { mode: "connected" }, viewerLabel: viewer.email, registrationOnly: true, invitedCalendarAvailable }, "Calendar content"));
      assert.doesNotMatch(html, /PRIVATE MENU|Member pages|href="\/my(?:"|\/account|\/circle|\/updates|\/foundations)/);
      const destination = pathname === "/my/experiences" ? "/my/registered" : "/my/experiences";
      assert.equal(html.includes(`href="${destination}"`), invitedCalendarAvailable);
      assert.match(html, /Sign out/);
    }
  }
});
