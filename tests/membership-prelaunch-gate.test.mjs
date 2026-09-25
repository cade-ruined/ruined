import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const origin = "https://members.example.test";
const viewer = { authUserId: "11111111-1111-4111-8111-111111111111", email: "returning@example.test" };
const invitee = { authUserId: "22222222-2222-4222-8222-222222222222", email: "complimentary@example.test" };
const invitationToken = "P".repeat(43);
const Stub = () => null;
const fail = () => assert.fail("Prelaunch must not reach a payment or external transport.");
class AccessDenied extends Error {}

// Fully populated synthetic live configuration; never read process.env or make
// a network request. Missing payment setup must not mask a broken launch gate.
function liveEnvironment(enabled) {
  return {
    NODE_ENV: "production", PLATFORM_MODE: "connected", DATABASE_URL: "offline-no-network",
    NEXT_PUBLIC_SITE_URL: origin, NEXT_PUBLIC_SUPABASE_URL: "https://supabase.invalid",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline-no-network",
    STRIPE_SECRET_KEY: "sk_live_synthetic_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_synthetic_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic_fixture", STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID: "price_monthly",
    STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID: "price_annual", STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION: "ruined_membership-v2",
    ...(enabled === undefined ? {} : { STRIPE_MEMBERSHIP_LIVE_ENABLED: enabled }),
  };
}

async function load(path, dependencies = {}, env = {}, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "fetch", ...Object.keys(globals), code)(name => {
    if (name === "server-only") return {};
    if (name === "react/jsx-runtime") return jsxRuntime;
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, { env }, fail, ...Object.values(globals));
  return loaded.exports;
}

async function fixture(enabled) {
  const env = liveEnvironment(enabled);
  const config = await load("src/lib/platform/config.ts", {}, env);
  const authRequest = await load("src/lib/auth/request.ts", {}, env);
  const pricing = await load("src/lib/membership/pricing.ts");
  const publicSignup = await load("src/lib/membership/public-signup.ts", { "@/lib/membership/pricing": pricing });
  const calls = { deliveries: [], verifications: [], claims: [], publicClaims: [], stripe: 0 };
  const repository = {
    PlatformAccessDeniedError: AccessDenied,
    getPasswordlessAccessEligibility: async (email, audience) => email === viewer.email && audience === "member" ? "returning" : "none",
    claimPlatformMemberForViewer: async (input, token) => {
      assert.ok(input.email === viewer.email && !token || input.email === invitee.email && token === invitationToken);
      calls.claims.push({ viewer: input, token });
    },
    getOperatorRole: async () => null,
    requireActivePlatformMemberLink: fail,
  };
  const admission = {
    claimPublicMembershipSignup: async input => { calls.publicClaims.push(input); },
    PublicMembershipSignupDeniedError: class extends Error {},
    consumePublicMembershipSignupRateLimit: async () => true,
    getPublicMembershipSignupEligibility: async () => true,
  };
  const platformAccess = await load("src/lib/auth/platform-access.ts", {
    "@/lib/auth/support-return": await load("src/lib/auth/support-return.ts"),
    "@/lib/platform/repository": repository,
    "@/lib/platform/ops-access-repository": { claimPlatformOperatorForViewer: fail },
    "@/lib/platform/operator-member-profile": { ensureOperatorMemberProfile: fail },
    "@/lib/membership/public-signup-admission": admission,
  }, env);
  const dependencies = {
    "next/server": { NextResponse }, "@/lib/auth/request": authRequest,
    "@/lib/platform/config": config, "@/lib/auth/platform-access": platformAccess,
    "@/lib/platform/repository": repository, "@/lib/membership/public-signup": publicSignup,
    "@/lib/membership/public-signup-admission": admission,
    "@/lib/membership/personal-invitation-admission": { getPersonalInvitationAdmissionEligibility: async (email, token) => email === invitee.email && token === invitationToken },
    "@/lib/supabase/server": { createSupabaseCurrentResponseClient: ({ response }) => ({ auth: {
      signInWithOtp: async input => { calls.deliveries.push(input); return { error: null }; },
      verifyOtp: async input => {
        calls.verifications.push(input);
        const identity = input.email === invitee.email ? invitee : viewer;
        response.cookies.set("test-session", "verified", { httpOnly: true, path: "/" });
        return { error: null, data: { user: { id: identity.authUserId, email: identity.email } } };
      },
      signOut: async () => { response.cookies.set("test-session", "", { maxAge: 0 }); return { error: null }; },
    } }) },
  };
  const request = await load("app/api/auth/otp/request/route.ts", dependencies, env);
  const verify = await load("app/api/auth/otp/verify/route.ts", dependencies, env);
  const checkout = await load("app/api/stripe/checkout/route.ts", {
    "next/server": { NextResponse }, "@/lib/platform/config": config, "@/lib/platform/repository": repository,
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
    "@/lib/membership/repository": { getMemberIdentity: async () => ({ membershipFunding: "self" }) },
    "@/lib/membership/pricing": pricing,
    "@/lib/stripe/membership-state": await load("src/lib/stripe/membership-state.ts"),
    "@/lib/stripe/billing-repository": {
      MembershipCheckoutConflictError: class extends Error {}, MembershipCheckoutPlanConflictError: class extends Error {},
      reserveMembershipCheckout: fail, expireMembershipCheckoutAttempt: fail, openMembershipCheckoutAttempt: fail,
    },
    "@/lib/stripe/server": {
      isTrustedCheckoutOrigin: authRequest.isTrustedPlatformOrigin,
      getStripe: () => { calls.stripe++; return { checkout: { sessions: { create: fail } } }; },
      getPaidMembershipAgreementVersion: fail, validateStripeMembershipPrice: fail,
      getStripeLivemode: fail, getApplicationOrigin: fail, isStripeTaxEnabled: fail,
    },
  }, env);
  const signupPage = await load("app/signup/page.tsx", {
    "@/components/public-members/MembershipSignupPage": Stub,
    "@/lib/platform/config": config, "@/lib/membership/pricing": pricing,
  }, env);
  const post = (route, body) => route.POST(new NextRequest(`${origin}/api/test`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { env, config, calls, request, verify, checkout, signupPage, authRequest, pricing, post };
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
}

for (const enabled of [undefined, "false"]) {
  test(`fully configured live payments remain closed before launch (flag ${enabled ?? "missing"})`, async t => {
    const f = await fixture(enabled);
    assert.equal(f.config.getPlatformConfiguration().mode, "connected");
    assert.equal(f.config.getPlatformConfiguration().stripe, "connected");
    assert.equal(f.config.getPlatformConfiguration().stripeCheckoutReady, false);

    await t.test("signup is disabled and direct OTP requests or existing codes cannot claim a member", async () => {
      for (const plan of ["monthly", "annual"]) {
        const page = await f.signupPage.default({ searchParams: Promise.resolve({ plan }) });
        assert.equal(page.props.initialPlan, plan);
        assert.equal(page.props.enabled, false);
        assert.equal(page.props.preview, false);
        const form = await load("src/components/platform/PasswordlessAccessForm.tsx", {
          react: { useState: initial => [initial, () => {}], useEffect: () => {} }, "next/link": Stub,
        }, f.env);
        await form.default({ enabled: page.props.enabled, signupPlan: plan }).props.onSubmit({ preventDefault() {} });
        assert.equal((await f.post(f.request, { email: "new@example.test", signup: { plan } })).status, 503);
        const denied = await f.post(f.verify, { email: viewer.email, token: "123456", signup: { plan } });
        assert.equal(denied.status, 503);
        assert.equal(denied.cookies.get("test-session")?.value, "");
        assert.equal((await denied.json()).redirectTo, undefined);
      }
      assert.equal(f.calls.deliveries.length, 0);
      assert.equal(f.calls.verifications.length, 0);
      assert.equal(f.calls.publicClaims.length, 0);
    });

    await t.test("an old email confirmation only returns to the gated signup page", async () => {
      let status = "neutral", effect;
      const guard = { current: false }, scrubbed = [];
      const confirmation = await load("src/components/platform/MemberEmailConfirmationStatus.tsx", {
        "next/link": Stub, "@/lib/membership/pricing": f.pricing,
        "@/lib/auth/email-confirmation": await load("src/lib/auth/email-confirmation.ts"),
        react: { useState: () => [status, next => { status = next; }], useRef: () => guard, useLayoutEffect: callback => { effect = callback; } },
      }, f.env, { window: {
        location: { search: "?code=old-provider-code", hash: "#access_token=old-access&type=signup&refresh_token=old-refresh" },
        history: { state: null, replaceState: (_state, _title, path) => scrubbed.push(path) },
      } });
      const page = await load("app/my/confirmed/page.tsx", {
        "next/headers": { cookies: async () => ({ get: name => name === "ruined-signup-context" ? { value: "annual" } : undefined }) },
        "@/components/platform/MemberEmailConfirmationStatus": confirmation.default,
        "@/lib/auth/request": f.authRequest, "@/lib/membership/pricing": f.pricing,
        "@/lib/membership/invitation-model": { MEMBER_INVITATION_TOKEN: /^[A-Za-z0-9_-]{43}$/ },
        "@/lib/sharing": { privateSharingMetadata: {} },
      }, f.env);
      const props = nodes(await page.default()).find(node => node.type === confirmation.default).props;
      confirmation.default(props);
      effect();
      assert.equal(status, "confirmed");
      assert.deepEqual(scrubbed, ["/my/confirmed"]);
      const link = nodes(confirmation.default(props)).find(node => node.type === Stub);
      assert.equal(link.props.href, "/signup?plan=annual");
      assert.equal((await f.signupPage.default({ searchParams: Promise.resolve({ plan: "annual" }) })).props.enabled, false);
      assert.equal(f.calls.publicClaims.length, 0);
      assert.equal(f.calls.verifications.length, 0);
    });

    await t.test("an already authenticated member cannot create or reserve a paid Checkout", async () => {
      for (const plan of ["monthly", "annual"]) {
        const response = await f.post(f.checkout, { plan, attemptId: viewer.authUserId, acceptanceId: invitee.authUserId, recurringPaymentAccepted: true });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).clientSecret, undefined);
      }
      assert.equal(f.calls.stripe, 0);
    });

    await t.test("normal returning sign-in and valid complimentary invitations retain their existing access paths", async () => {
      for (const [identity, context, redirect] of [[viewer, {}, "/my"], [invitee, { invitationToken }, "/my/join"]]) {
        assert.equal((await f.post(f.request, { email: identity.email, ...context })).status, 200);
        const verified = await f.post(f.verify, { email: identity.email, token: "123456", ...context });
        assert.equal(verified.status, 200);
        assert.equal((await verified.json()).redirectTo, redirect);
        assert.equal(verified.cookies.get("test-session")?.value, "verified");
      }
      assert.deepEqual(f.calls.deliveries.map(call => call.options.shouldCreateUser), [false, true]);
      assert.deepEqual(f.calls.claims, [{ viewer, token: undefined }, { viewer: invitee, token: invitationToken }]);
      assert.equal(f.calls.publicClaims.length, 0);
      assert.equal(f.calls.stripe, 0);
    });
  });
}

test("explicit launch authorization is the only differing setting needed to enable this complete live configuration", async () => {
  const f = await fixture("true");
  assert.equal(f.config.getPlatformConfiguration().stripeCheckoutReady, true);
  assert.equal((await f.signupPage.default({ searchParams: Promise.resolve({ plan: "annual" }) })).props.enabled, true);
  assert.equal((await f.post(f.request, { email: "new@example.test", signup: { plan: "annual" } })).status, 200);
  assert.equal(f.calls.deliveries.length, 1, "Provider is a local stub; no email is actually sent.");
  assert.equal(f.calls.publicClaims.length, 0);
  assert.equal(f.calls.stripe, 0);
});
