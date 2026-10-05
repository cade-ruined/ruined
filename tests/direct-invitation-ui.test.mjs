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
  const slots = [], effects = [], calls = [], signals = [], locked = [], navigations = [], focuses = [];
  const timers = new Map();
  let cursor = 0, nextId = 0, nextTimer = 0, clock = 1_800_000_000_000, pendingEffects = [];
  const hooks = { ...React, useId: () => "request-form",
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) {
      const i = cursor++, prior = effects[i];
      if (!prior || !deps || deps.some((value, index) => !Object.is(value, prior.deps[index]))) {
        pendingEffects.push(() => { prior?.cleanup?.(); effects[i] = { deps, cleanup: effect() }; });
      }
    },
  };
  const component = (await load("src/components/public-members/DirectInvitationRequestForm.tsx", { react: hooks, "next/link": "a" }, {
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}` },
    Date: class extends Date { static now() { return clock; } },
    window: { location: { origin: "https://members.example.test", assign: destination => navigations.push(destination) },
      setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id) },
    fetch: async (url, init) => {
      const call = { url, body: JSON.parse(init.body), method: init.method }; calls.push(call); signals.push(init.signal);
      return handler ? handler(call, init) : { ok: true, json: async () => url.endsWith("/verify") ? { redirectTo: "/my/join" } : { ok: true, requestId: "generic-reference" } };
    },
  })).default;
  const props = { billingPlan: "annual", onRequestStateChange: value => locked.push(value) };
  const draw = () => {
    cursor = 0; pendingEffects = [];
    const tree = component(props);
    for (const node of nodes(tree)) if (node.type === "input" && node.props.ref) node.props.ref.current ??= { focus: () => focuses.push(node.props.name) };
    pendingEffects.forEach(run => run());
    return tree;
  };
  const fill = (name, value) => {
    const input = nodes(draw()).find(node => node.props.name === name);
    assert.ok(input, `${name} input exists`); input.props.onChange({ target: { value } });
  };
  const button = label => {
    const result = nodes(draw()).find(node => node.type === "button" && text(node).startsWith(label));
    assert.ok(result, `${label} button exists`); return result;
  };
  const submit = () => nodes(draw()).find(node => node.type === "form").props.onSubmit(event);
  fill("recipientName", " Alex   Rivera "); fill("recipientEmail", " ALEX@Example.test ");
  return { draw, fill, button, submit, calls, signals, locked, navigations, focuses, props,
    advance(milliseconds) { clock += milliseconds; for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } return draw(); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); }, uuidCount: () => nextId,
  };
}

test("registration starts a tracked invitation and goes directly to a focused email-code field", async () => {
  const f = await requestFixture();
  await f.submit();
  assert.deepEqual(f.calls, [{ url: "/api/membership/signup/start", method: "POST", body: {
    requestId: "00000000-0000-4000-8000-000000000001", recipientName: "Alex Rivera", recipientEmail: "alex@example.test", billingPlan: "annual",
  } }]);
  assert.deepEqual(f.locked, [true]);
  assert.match(text(f.draw()), /Look for a verification code at alex@example\.test/);
  assert.doesNotMatch(text(f.draw()), /Open your invitation|Accept the card|invitation (?:was|has been) sent|account (?:was|has been) created/);
  const field = nodes(f.draw()).find(node => node.props.name === "token");
  assert.equal(field.props.autoComplete, "one-time-code"); assert.equal(field.props.inputMode, "numeric");
  assert.equal(field.props.minLength, 6); assert.equal(field.props.maxLength, 10);
  assert.equal(f.focuses.at(-1), "token");
  assert.deepEqual(f.navigations, []);
});

test("card-preview personalization uses only the controlled name and does not issue an invitation", async () => {
  const f = await requestFixture(), names = [];
  f.props.onRecipientNameChange = name => names.push(name);
  f.fill("recipientName", "  Morgan   Hill  ");
  f.fill("recipientEmail", "private@example.test");
  f.fill("recipientName", "");
  assert.deepEqual(names, ["Morgan Hill", ""]);
  assert.equal(nodes(f.draw()).find(node => node.props.name === "recipientName").props.value, "");
  assert.equal(f.calls.length, 0);
});

test("prelaunch registration keeps optional card saving distinct from membership activation", async () => {
  const f = await requestFixture(); f.props.paymentSetupOnly = true;
  assert.match(text(f.draw()), /Saving a payment method is optional.*does not start membership or authorize a charge/);
  await f.submit();
  assert.match(text(f.draw()), /continue to your profile/);
  assert.doesNotMatch(text(f.draw()), /complete payment|membership is active|accept.*card/i);
});

test("an uncertain start retries the same identity; changed details receive a new identity", async () => {
  const f = await requestFixture(async () => { throw new Error("Network interrupted"); });
  await f.submit(); await f.submit();
  assert.equal(f.calls[0].body.requestId, f.calls[1].body.requestId);
  assert.match(text(f.draw()), /Network interrupted/);
  f.fill("recipientName", "New name"); await f.submit();
  assert.notEqual(f.calls[1].body.requestId, f.calls[2].body.requestId);
  f.props.billingPlan = "monthly"; await f.submit();
  assert.notEqual(f.calls[2].body.requestId, f.calls[3].body.requestId);
  assert.deepEqual(f.locked, [true, false, true, false, true, false, true, false]);
});

test("changing email clears the code, preserves name, restores focus, and starts a fresh recipient request", async () => {
  const f = await requestFixture(); await f.submit(); f.fill("token", "123456");
  f.button("Change email").props.onClick();
  assert.equal(nodes(f.draw()).find(node => node.props.name === "recipientName").props.value, " Alex   Rivera ");
  assert.equal(f.focuses.at(-1), "recipientEmail");
  f.fill("recipientEmail", "corrected@example.test"); await f.submit();
  assert.equal(nodes(f.draw()).find(node => node.props.name === "token").props.value, "");
  assert.equal(f.calls.length, 2); assert.notEqual(f.calls[0].body.requestId, f.calls[1].body.requestId);
  assert.equal(f.calls[1].body.recipientEmail, "corrected@example.test");
  assert.deepEqual(f.locked, [true, false, true]);
});

test("a cooldown prevents immediate resend and reentering unchanged details reuses the code screen", async () => {
  const f = await requestFixture(); await f.submit();
  assert.equal(f.button("Send again in 60s").props.disabled, true);
  await f.button("Send again in 60s").props.onClick(); assert.equal(f.calls.length, 1);
  f.advance(59_000); assert.equal(f.button("Send again in 1s").props.disabled, true);
  f.button("Change email").props.onClick(); await f.submit();
  assert.equal(f.calls.length, 1, "returning to an unchanged address does not bypass the cooldown");
  assert.ok(nodes(f.draw()).find(node => node.props.name === "token"));
  f.advance(1_000); assert.equal(f.button("Send a new code").props.disabled, false);
  await f.button("Send a new code").props.onClick();
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1], f.calls[0]);
  assert.equal(f.button("Send again in 60s").props.disabled, true);
});

test("verification sends only the bound email, numeric code, and directSignup marker then follows server routing", async () => {
  for (const destination of ["/my", "/my/join", "/my/account?view=profile", "/ops", "/membership#your-invitation"]) {
    const f = await requestFixture(call => ({ ok: true, json: async () => call.url.endsWith("/verify") ? { redirectTo: destination } : { ok: true } }));
    await f.submit(); f.fill("token", "12a3 456"); await f.submit();
    assert.deepEqual(f.calls[1], { url: "/api/auth/otp/verify", method: "POST", body: { email: "alex@example.test", token: "123456", directSignup: true } });
    assert.deepEqual(f.navigations, [destination]);
    assert.equal(nodes(f.draw()).find(node => node.type === "fieldset").props.disabled, true, "hold form pending until navigation completes");
    assert.deepEqual(f.locked, [true], "verification does not unlock the selected plan");
  }
});

test("invalid verification codes and unsafe redirects never leave the code screen", async () => {
  const malformed = await requestFixture(); await malformed.submit(); malformed.fill("token", "12345"); await malformed.submit();
  assert.equal(malformed.calls.length, 1); assert.match(text(malformed.draw()), /6–10 digit/);
  for (const destination of ["https://untrusted.example", "//untrusted.example", "/my/../../access", "/my\\evil", "/my\n/evil", "/my-other", "/ops/other", undefined]) {
    const f = await requestFixture(call => ({ ok: true, json: async () => call.url.endsWith("/verify") ? { redirectTo: destination } : { ok: true } }));
    await f.submit(); f.fill("token", "123456"); await f.submit();
    assert.deepEqual(f.navigations, []); assert.match(text(f.draw()), /could not be verified/);
    assert.equal(nodes(f.draw()).find(node => node.type === "fieldset").props.disabled, false);
    assert.equal(f.focuses.at(-1), "token");
  }
});

test("verification and resend errors are retryable without losing recipient context or unlocking the plan", async () => {
  let failVerify = true, starts = 0;
  const f = await requestFixture(call => {
    if (call.url.endsWith("/start")) return ++starts === 1 ? { ok: true, json: async () => ({ ok: true }) } : { ok: false, json: async () => ({ error: "Wait a moment before requesting another code." }) };
    return failVerify ? { ok: false, json: async () => ({ error: "That code has expired." }) } : { ok: true, json: async () => ({ redirectTo: "/my/join" }) };
  });
  await f.submit(); f.fill("token", "123456"); await f.submit();
  assert.match(text(f.draw()), /That code has expired/); assert.deepEqual(f.navigations, []);
  f.advance(60_000); await f.button("Send a new code").props.onClick();
  assert.match(text(f.draw()), /Wait a moment/); assert.match(text(f.draw()), /alex@example\.test/);
  assert.deepEqual(f.calls[2], f.calls[0]);
  assert.ok(f.locked.every(Boolean));
  failVerify = false; f.fill("token", "654321"); await f.submit();
  assert.deepEqual(f.navigations, ["/my/join"]);
});

test("duplicate start and verify submits cannot send two requests or trust returned bearer data", async () => {
  let release;
  const f = await requestFixture(() => new Promise(resolve => { release = payload => resolve({ ok: true, json: async () => payload }); }));
  const first = f.submit(); await f.submit();
  assert.equal(f.calls.length, 1); release({ ok: true, url: "https://untrusted.example", invitationToken: "private-value" }); await first;
  assert.doesNotMatch(text(f.draw()), /untrusted|private-value/);
  f.fill("token", "123456"); const verifying = f.submit(); await f.submit();
  f.button("Change email").props.onClick(); assert.equal(f.calls.length, 2);
  assert.ok(nodes(f.draw()).find(node => node.props.name === "token"));
  release({ redirectTo: "/my/join" }); await verifying;
  assert.deepEqual(f.navigations, ["/my/join"]);
});

test("unmount aborts pending registration or verification and ignores late responses", async () => {
  for (const pendingStage of ["start", "verify"]) {
    let release;
    const f = await requestFixture(call => call.url.endsWith(`/${pendingStage}`)
      ? new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ ok: true, redirectTo: "/my/join" }) }); })
      : { ok: true, json: async () => ({ ok: true }) });
    let request;
    if (pendingStage === "start") request = f.submit();
    else { await f.submit(); f.fill("token", "123456"); request = f.submit(); }
    f.unmount(); assert.equal(f.signals.at(-1).aborted, true); release(); await request;
    assert.deepEqual(f.navigations, []);
  }
});

test("unopened signup renders the waitlist; launched signup keeps exact prices and invitation form", async () => {
  const component = (await load("src/components/public-members/MembershipSignup.tsx", {
    react: React, "@/lib/membership/pricing": pricing,
    "./DirectInvitationRequestForm": props => React.createElement("div", { "data-request-plan": props.billingPlan }),
    "./MembershipWaitlistForm": props => React.createElement("form", { "aria-label": "Membership waitlist", "data-disabled": String(props.disabled) }),
  })).default;
  const render = props => renderToStaticMarkup(React.createElement(component, { plan: "annual", onPlanChange() {}, ...props }));
  const closed = render({ enabled: false });
  assert.match(closed, /Membership waitlist/); assert.doesNotMatch(closed, /data-request-plan|\$4,990|Verify email/);
  assert.match(render({ enabled: false, preview: true }), /data-disabled="true"/);
  const live = render({ enabled: true });
  assert.match(live, /\$4,990/); assert.match(live, /data-request-plan="annual"/); assert.match(live, /Your invitation/);
  assert.match(live, /Choose your signup plan/);
  assert.equal((live.match(/type="radio"/g) ?? []).length, 2, "standalone signup keeps its own billing selector by default");
  assert.doesNotMatch(live, /founding|couple|\$349|\$699/);
  assert.doesNotMatch(live, /Membership waitlist/);
  const inline = render({ enabled: true, showPricing: false });
  assert.match(inline, /data-request-plan="annual"/, "the shared offer's billing preference still reaches invitation creation");
  assert.doesNotMatch(inline, /type="radio"|\$4,990|Choose your signup plan/);
  assert.match(render({ enabled: false, showPricing: false }), /Membership waitlist/, "hiding duplicate prices must not bypass the admission gate");
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

test("invitation-form preview shows inline code without emails, authentication, or fake navigation", async () => {
  const f = await requestFixture(() => assert.fail("Preview must never contact signup or authentication"));
  f.props.preview = true;
  f.fill("recipientName", "Preview Member"); f.fill("recipientEmail", "preview@example.test");
  assert.match(text(f.draw()), /Preview next step/);
  assert.match(text(f.draw()), /No email, account, or payment will be created/);
  await f.submit();
  assert.match(text(f.draw()), /Preview for preview@example\.test.*No code was sent and no account was created/);
  f.fill("token", "123456"); await f.submit();
  assert.match(text(f.draw()), /verification cannot create an account here/);
  f.advance(60_000); await f.button("Send a new code").props.onClick();
  assert.equal(nodes(f.draw()).find(node => node.props.name === "token").props.value, "");
  f.button("Change email").props.onClick();
  assert.equal(nodes(f.draw()).find(node => node.props.name === "recipientName").props.value, "Preview Member");
  assert.deepEqual(f.calls, []); assert.deepEqual(f.navigations, []); assert.equal(f.uuidCount(), 0);
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
    "@/components/public-members/MembershipOverview": Stub,
  });
  const params = { searchParams: Promise.resolve({ source: "ruined_direct", membership: "complimentary" }) };
  const direct = await page.default(params);
  assert.equal(direct.props.invitation.invitationSource, "ruined_direct"); assert.equal(direct.props.invitation.recipientName, "Cherry Hill");
  assert.equal(direct.props.invitation.membershipType, "standard"); assert.equal(direct.props.preview, true);
  assert.equal(direct.props.invitation.token, undefined);
  assert.equal(direct.props.invitation.expiresAt, "2099-01-01T00:00:00Z");
  assert.equal(direct.props.invitation.card.name, "The Ruined Project");
  const textInvite = await page.default({ searchParams: Promise.resolve({ delivery: "text" }) });
  assert.equal(textInvite.props.invitation.recipientEmailRequired, false);
  assert.equal(textInvite.props.invitation.token, undefined);
  assert.equal(textInvite.props.invitation.expiresAt, null);
  assert.equal(textInvite.props.invitation.recipientName, "Alex Rivera");
  assert.equal(textInvite.props.preview, true);
  mode = "connected"; await assert.rejects(page.default(params), /not_found/);
});

test("setup-only signup names optional card storage and makes plan choice a preference", async () => {
  const component = (await load("src/components/public-members/MembershipSignup.tsx", {
    react: React, "@/lib/membership/pricing": pricing,
    "./DirectInvitationRequestForm": props => React.createElement("div", { "data-setup-only": String(props.paymentSetupOnly) }),
    "./MembershipWaitlistForm": Stub,
  })).default;
  const html = renderToStaticMarkup(React.createElement(component, { enabled: true, paymentSetupOnly: true, plan: "monthly", onPlanChange() {} }));
  assert.match(html, /Future membership/); assert.match(html, /Enter your name and email, verify the code we send, then create your profile/);
  assert.match(html, /preference, not a purchase or reserved offer/); assert.match(html, /No payment is due now/);
  assert.match(html, /data-setup-only="true"/); assert.doesNotMatch(html, /first payment completes signup|due at signup/);
});

test("overview payment FAQ matches optional setup without changing paid signup terms", async () => {
  const Questions = (await load("src/components/public-members/MembershipQuestions.tsx")).default;
  const component = (await load("src/components/public-members/MembershipOverview.tsx", {
    react: React, "next/image": Stub, "next/link": "a",
    "@/data/public-membership": { MEMBERSHIP_LINKS: { signIn: "/access" } },
    "@/components/membership/PersonalInvitationAcceptance": () => null,
    "@/components/membership/use-invitation-expiry": { useInvitationExpired: value => value ? Date.parse(value) <= Date.now() : false },
    "./MembershipWaitlistForm": () => null,
    "@/lib/membership/pricing": pricing, "./MembershipSignup": Stub, "./MembershipInvitationCard": { __esModule: true, default: Stub, MembershipInvitationRoom: ({ children }) => children },
    "./MembershipFoundationsSection": Stub, "./MembershipMonthlySection": Stub, "./MembershipCommunitySection": Stub,
    "./MembershipOfferSection": Stub, "./MembershipQuestions": Questions, "./MembershipOpportunityCalls": Stub,
  })).default;
  const faq = (paymentSetupOnly, question) => {
    const html = renderToStaticMarkup(React.createElement(component, { signupEnabled: true, paymentSetupOnly }));
    return [...html.matchAll(/<details>([\s\S]*?)<\/details>/g)].map(match => match[1]).find(answer => answer.includes(question));
  };
  const setup = faq(true, "When do I pay?");
  assert.match(setup, /There is no payment due to join the waitlist or prepare your profile/);
  assert.match(setup, /If card saving is available, it is optional and does not authorize future charges/);
  assert.match(setup, /When paid membership opens.*review the current offer, agreement, and payment terms.*explicitly confirm payment/);
  assert.doesNotMatch(setup, /At signup|payment is due when you join/);
  const paid = faq(false, "When do I pay?");
  assert.match(paid, /Your first monthly installment or full annual payment is due when you activate paid membership/);
  assert.match(paid, /Applicable tax is shown before you authorize payment/);
  assert.doesNotMatch(paid, /No payment is due now|first payment is taken at signup/);
  assert.match(faq(false, "Can I cancel?"), /12-month commitment.*does not erase the initial monthly installments.*Prepaid annual plans renew annually/);
});

test("landing signup stays inline beside the Ruined card, preserving launch mode and one invitation destination", async () => {
  const signups = [], cards = [];
  const component = (await load("src/components/public-members/MembershipOverview.tsx", {
    react: React, "next/image": Stub, "next/link": "a",
    "@/data/public-membership": { MEMBERSHIP_LINKS: { signIn: "/access" } },
    "@/components/membership/PersonalInvitationAcceptance": () => null,
    "@/components/membership/use-invitation-expiry": { useInvitationExpired: value => value ? Date.parse(value) <= Date.now() : false },
    "./MembershipWaitlistForm": () => null,
    "@/lib/membership/pricing": pricing,
    "./MembershipFoundationsSection": Stub, "./MembershipMonthlySection": Stub, "./MembershipCommunitySection": Stub,
    "./MembershipOfferSection": Stub, "./MembershipQuestions": Stub, "./MembershipOpportunityCalls": Stub,
    "./MembershipSignup": props => { signups.push(props); return React.createElement("div", { "data-signup-inline": true }); },
    "./MembershipInvitationCard": { __esModule: true, default: props => { cards.push(props); return React.createElement("div", { "data-direct-invitation-card": true }); }, MembershipInvitationRoom: ({ children }) => children },
  })).default;
  for (const props of [
    { preview: false, signupEnabled: true, paymentSetupOnly: false },
    { preview: false, signupEnabled: true, paymentSetupOnly: true },
    { preview: true, signupEnabled: false, paymentSetupOnly: true },
    { preview: false, signupEnabled: false, paymentSetupOnly: true },
  ]) {
    signups.length = 0; cards.length = 0;
    const html = renderToStaticMarkup(React.createElement(component, props));
    assert.equal(signups.length, 1, "Signup is immediately available without opening a modal");
    assert.equal(cards.length, 1, "The actual interactive invitation component accompanies signup");
    assert.equal(signups[0].enabled, props.signupEnabled);
    assert.equal(signups[0].preview, props.preview);
    const invitationAvailable = props.signupEnabled || (props.preview && props.paymentSetupOnly);
    assert.equal(signups[0].paymentSetupOnly, invitationAvailable && props.paymentSetupOnly);
    assert.equal(signups[0].previewInvitation, props.preview && invitationAvailable && props.paymentSetupOnly);
    assert.equal(signups[0].showPricing, false, "the card section owns pricing instead of repeating it inside the form");
    assert.equal(typeof signups[0].onRecipientNameChange, "function");
    assert.match(html, /id="your-invitation"/);
    assert.match(html, /href="#your-invitation"/);
    assert.match(html, /data-signup-inline="true"/);
    assert.match(html, /data-direct-invitation-card="true"/);
    if (invitationAvailable) assert.doesNotMatch(html, /Join the waitlist/);
    else { assert.match(html, /Join the waitlist/); assert.doesNotMatch(html, /Register for launch/); }
    assert.equal((html.match(/<dialog\b/g) ?? []).length, 1, "Only the film needs a modal");
  }
});

test("signup and membership routes pass setup-only mode only for deliberately opened admission", async () => {
  let configuration = { mode: "connected", stripeCheckoutReady: false, membershipSignupReady: true };
  const dependencies = { "@/lib/platform/config": { getPlatformConfiguration: () => configuration },
    "@/lib/membership/pricing": pricing, "@/components/public-members/MembershipSignupPage": Stub,
    "@/components/public-members/MembershipOverview": Stub };
  const signup = await load("app/signup/page.tsx", dependencies);
  const overview = await load("app/membership/page.tsx", dependencies);
  assert.equal((await signup.default({ searchParams: Promise.resolve({}) })).props.paymentSetupOnly, true);
  assert.equal((await overview.default({ searchParams: Promise.resolve({}) })).props.paymentSetupOnly, true);
  configuration = { ...configuration, stripeCheckoutReady: true };
  assert.equal((await overview.default({ searchParams: Promise.resolve({}) })).props.paymentSetupOnly, false);
  configuration = { ...configuration, stripeCheckoutReady: false, membershipSignupReady: false };
  assert.equal((await overview.default({ searchParams: Promise.resolve({}) })).props.signupEnabled, false);
  assert.equal((await signup.default({ searchParams: Promise.resolve({}) })).props.enabled, false);
});

test("public setup admission is separately enabled and never opens paid Checkout", async () => {
  const env = { NODE_ENV: "production", PLATFORM_MODE: "connected", DATABASE_URL: "offline",
    NEXT_PUBLIC_SUPABASE_URL: "https://offline.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline",
    STRIPE_SECRET_KEY: "sk_live_offline", STRIPE_WEBHOOK_SECRET: "whsec_offline", STRIPE_PAYMENT_SETUP_ACCOUNT_ID: "acct_offline",
    STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED: "true" };
  const config = await load("src/lib/platform/config.ts", { "server-only": {} }, { process: { env } });
  assert.equal(config.getPlatformConfiguration().stripePaymentSetupReady, true);
  assert.equal(config.getPlatformConfiguration().membershipSignupReady, false, "saving for invited accounts does not silently open acquisition");
  env.STRIPE_MEMBERSHIP_PAYMENT_SETUP_SIGNUP_ENABLED = "true";
  assert.equal(config.getPlatformConfiguration().membershipSignupReady, true);
  assert.equal(config.getPlatformConfiguration().stripeCheckoutReady, false);
  env.STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED = "false";
  assert.equal(config.getPlatformConfiguration().membershipSignupReady, false);
});


test("payment-setup preview shows inert copy only outside production admission", async () => {
  let configuration = { mode: "preview", stripeCheckoutReady: false, membershipSignupReady: false };
  const deps = { "@/lib/platform/config": { getPlatformConfiguration: () => configuration },
    "@/lib/membership/pricing": pricing, "@/components/public-members/MembershipSignupPage": Stub,
    "@/components/public-members/MembershipOverview": Stub };
  const signup = await load("app/signup/page.tsx", deps);
  const overview = await load("app/membership/page.tsx", deps);
  const props = { searchParams: Promise.resolve({ preview: "payment-setup" }) };
  assert.equal((await signup.default(props)).props.previewInvitation, true);
  assert.equal((await signup.default(props)).props.paymentSetupOnly, true);
  assert.equal((await signup.default(props)).props.enabled, false);
  assert.equal((await overview.default(props)).props.paymentSetupOnly, true);
  for (const mode of ["connected", "unavailable"]) {
    configuration = { ...configuration, mode };
    assert.equal((await signup.default(props)).props.paymentSetupOnly, false);
    assert.equal((await signup.default(props)).props.previewInvitation, false);
    assert.equal((await signup.default(props)).props.enabled, false);
    assert.equal((await overview.default(props)).props.paymentSetupOnly, false);
    assert.equal((await overview.default(props)).props.signupEnabled, false);
  }
});
