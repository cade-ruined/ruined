import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const Stub = () => null;
const Link = ({ children, ...props }) => React.createElement("a", props, children);
async function load(path, deps = {}, globals = {}) {
  const js = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), js)(name => name in deps ? deps[name] : require(name), result, result.exports, ...Object.values(globals));
  return result.exports;
}
function hooks() {
  let cursor = 0;
  const slots = [], effects = [];
  return { effects, react: { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useId() { const i = cursor++; if (!(i in slots)) slots[i] = `fixture-${i}`; return slots[i]; },
    useEffect(effect) { const i = cursor++; if (!(i in slots)) { slots[i] = effects.length; effects.push(effect); } else effects[slots[i]] = effect; },
  }, render(component, props) { cursor = 0; return component(props); } };
}
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" ? node : "";
const flush = () => new Promise(resolve => setImmediate(resolve));
const paymentModel = await load("src/lib/stripe/payment-method-model.ts");
const snapshot = (state = "not_saved", changes = {}) => ({ enabled: true, eligible: true, reason: null, state, canRemove: state === "saved", removalPending: false, paymentMethod: state === "saved" ? { type: "card", label: "Visa ending in 4242", last4: "4242", expMonth: 12, expYear: 2030 } : null, ...changes });

async function fixture({ state = "not_saved", changes = {}, props = {} } = {}) {
  const h = hooks(), calls = [], redirects = [];
  let response = snapshot(state, changes), failure = null, destination = "https://checkout.stripe.com/c/pay/setup-fixture", attempts = 0;
  const View = (await load("src/components/membership/MemberPaymentMethod.tsx", { react: h.react, "react/jsx-runtime": jsxRuntime, "next/link": Link, "@/lib/stripe/payment-method-model": paymentModel }, {
    crypto: { randomUUID: () => `11111111-1111-4111-8111-${String(++attempts).padStart(12,"1")}` },
    window: { location: { assign: url => redirects.push(url) } },
    fetch: async (_url, options = {}) => {
      calls.push({ method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
      if (failure) return { ok: false, json: async () => ({ error: failure }) };
      return { ok: true, json: async () => options.method === "POST" ? { url: destination } : response };
    },
  })).default;
  const render = () => h.render(View, props);
  render(); for (const effect of h.effects) effect(); await flush();
  return { calls, redirects, render,
    button: label => nodes(render()).find(node => node.type === "button" && text(node) === label),
    consent: () => nodes(render()).find(node => node.props.name === "save-payment-method-consent"),
    submit: () => nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }),
    setResponse: value => { response = value; }, fail: value => { failure = value; }, destination: value => { destination = value; },
    reload: async () => { h.effects[0](); await flush(); },
    receiptEffect: () => h.effects[1](),
  };
}

test("saving requires new unchecked save-only consent and never posts checkout or recurring billing authorization", async () => {
  const f = await fixture();
  assert.equal(f.consent().props.checked, false);
  assert.equal(f.button("Save payment method securely").props.disabled, true);
  assert.match(text(f.render()), /You won’t be charged today/);
  assert.match(text(f.render()), /confirm before membership begins/);
  assert.ok(text(f.render()).includes(paymentModel.PAYMENT_SETUP_CONSENT_TEXT), "show the exact versioned consent stored by the server");
  assert.ok(nodes(f.render()).some(node => node.props.href === "/my/account" && text(node) === "Do this later"));
  await f.submit(); assert.equal(f.calls.length, 1);
  f.consent().props.onChange({ target: { checked: true } }); await f.submit();
  assert.deepEqual(f.calls[1], { method: "POST", body: { attemptId: "11111111-1111-4111-8111-111111111111", consentAccepted: true, consentVersion: "save-payment-method-v2" } });
  assert.deepEqual(f.redirects, ["https://checkout.stripe.com/c/pay/setup-fixture"]);
});

test("a return URL cannot claim saved: pending/late webhooks remain unconfirmed until GET changes", async () => {
  const f = await fixture({ state: "pending", props: { returnState: "returned" } });
  assert.match(text(f.render()), /Waiting for Stripe confirmation/);
  assert.doesNotMatch(text(f.render()), /Payment method saved/);
  assert.equal(f.consent().props.checked, false);
  f.button("Check again").props.onClick();
  f.setResponse(snapshot("saved")); await f.reload();
  assert.match(text(f.render()), /Payment method saved.*Awaiting launch/);
  assert.match(text(f.render()), /Visa ending in 4242/);
  assert.doesNotMatch(text(f.render()), /4242 4242|pm_|cus_|seti_/);
  assert.equal(f.calls.filter(call => call.method !== "GET").length, 0);
  const late = await fixture({ props: { returnState: "returned" } });
  assert.match(text(late.render()), /haven’t received confirmation/);
  assert.doesNotMatch(text(late.render()), /Payment method saved/);
});

test("cancelled setup stays optional and never turns cancellation into a saved confirmation", async () => {
  const f = await fixture({ props: { returnState: "cancelled" } });
  assert.match(text(f.render()), /left setup before finishing/);
  assert.match(text(f.render()), /No payment was taken/);
  assert.equal(f.consent().props.checked, false);
  assert.doesNotMatch(text(f.render()), /Payment method saved/);
});

test("provider errors preserve consent and the idempotency attempt for retry; foreign destinations never navigate", async () => {
  const f = await fixture(); f.consent().props.onChange({ target: { checked: true } });
  f.fail("Stripe is temporarily unavailable."); await f.submit();
  assert.match(text(f.render()), /Stripe is temporarily unavailable/);
  assert.equal(f.redirects.length, 0);
  f.fail(null); f.destination("https://example.invalid/collect-card"); await f.submit();
  assert.equal(f.redirects.length, 0);
  assert.equal(f.calls[1].body.attemptId, f.calls[2].body.attemptId);
  assert.match(text(f.render()), /Secure payment-method setup could not be opened/);
});

test("an expired or revoked setup recovers with a fresh attempt only after authoritative status refresh", async () => {
  const f = await fixture(); f.consent().props.onChange({ target: { checked: true } });
  f.fail("Start a new payment setup attempt."); await f.submit();
  const previousAttempt = f.calls.at(-1).body.attemptId;
  f.fail(null); f.setResponse(snapshot());
  f.button("Check payment-method status").props.onClick(); await f.reload();
  assert.equal(f.consent().props.checked,false,"a new attempt starts with fresh save-only consent");
  f.consent().props.onChange({ target: { checked: true } }); await f.submit();
  assert.notEqual(f.calls.at(-1).body.attemptId,previousAttempt);
  assert.deepEqual(f.redirects,["https://checkout.stripe.com/c/pay/setup-fixture"]);
});

test("removal waits for dialog confirmation and resets consent only after server success", async () => {
  const f = await fixture({ state: "saved" });
  f.button("Remove saved payment method").props.onClick();
  assert.equal(f.calls.length, 1);
  f.button("Keep payment method").props.onClick(); assert.equal(f.calls.length, 1);
  f.button("Remove saved payment method").props.onClick();
  f.setResponse(snapshot()); await f.button("Remove payment method").props.onClick();
  assert.deepEqual(f.calls[1], { method: "DELETE", body: { confirmation: true } });
  assert.match(text(f.render()), /Saved payment method removed/);
  assert.equal(f.consent().props.checked, false);
  assert.equal(f.button("Save payment method securely").props.disabled, true);
});

test("a rejected removal rereads the committed state and never claims success", async () => {
  const f = await fixture({ state: "saved" });
  f.button("Remove saved payment method").props.onClick();
  f.fail("A membership is already using this payment method.");
  await f.button("Remove payment method").props.onClick();
  assert.match(text(f.render()), /already using this payment method/);
  assert.match(text(f.render()), /Checking your payment method/);
  assert.doesNotMatch(text(f.render()), /Saved payment method removed/);
});

test("a failed detach remains removable after reload even though setup eligibility is false", async () => {
  const f = await fixture({ state: "pending", changes: { eligible: false, canRemove: true, removalPending: true, reason: "Your payment method removal is still being confirmed. Try removing it again." } });
  assert.match(text(f.render()), /Finishing removal/);
  assert.match(text(f.render()), /permission to save this method has been withdrawn/);
  assert.equal(f.consent(), undefined);
  f.button("Retry removal").props.onClick();
  assert.equal(f.calls.length,1);
  f.setResponse(snapshot()); await f.button("Remove payment method").props.onClick();
  assert.deepEqual(f.calls.at(-1), { method: "DELETE", body: { confirmation: true } });
  assert.match(text(f.render()), /Saved payment method removed/);
});

test("a complimentary member can remove an unused saved method without permission to save another", async () => {
  const f = await fixture({ state: "saved", changes: { eligible: false, canRemove: true, reason: "Your membership is complimentary." } });
  assert.equal(f.consent(),undefined);
  assert.equal(f.button("Remove saved payment method").props.disabled,false);
  f.button("Remove saved payment method").props.onClick();
  f.setResponse(snapshot("not_saved", { eligible: false, canRemove: false }));
  await f.button("Remove payment method").props.onClick();
  assert.equal(f.calls.at(-1).method,"DELETE");
});

test("ineligible/disabled responses do not expose setup controls; live-data failures remain retryable", async () => {
  for (const changes of [{ eligible: false, reason: "Your complimentary membership needs no payment method." }, { enabled: false, reason: "Setup is temporarily unavailable." }]) {
    const f = await fixture({ changes }); assert.equal(f.consent(), undefined); assert.ok(text(f.render()).includes(changes.reason));
  }
  const f = await fixture(); f.fail("Status unavailable."); f.button("Save payment method securely"); await f.reload();
  assert.match(text(f.render()), /Status unavailable/);
  assert.ok(f.button("Check payment-method status"));
  assert.ok(nodes(f.render()).some(node => node.props.href === "/my/support"));
});

test("preview can show setup, pending and saved states without reads, writes or redirects", async () => {
  const f = await fixture({ props: { preview: true } });
  assert.equal(f.calls.length, 0);
  f.consent().props.onChange({ target: { checked: true } }); await f.submit();
  assert.equal(f.calls.length, 0);
  f.button("Saved").props.onClick(); assert.match(text(f.render()), /Awaiting launch/);
  assert.equal(f.button("Remove saved payment method").props.disabled, true);
  f.button("Confirming").props.onClick(); assert.match(text(f.render()), /Waiting for Stripe confirmation/);
  f.button("Setup").props.onClick(); assert.equal(f.consent().props.checked, false);
  assert.deepEqual(f.redirects, []);
});

test("prelaunch profile completion offers optional setup before unpublished agreement; complimentary entry stays separate", async () => {
  const Payment = () => React.createElement("div", { "data-optional-payment": true });
  const Join = (await load("src/components/membership/JoinForm.tsx", {
    "next/link": Link, "@stripe/stripe-js": { loadStripe: () => { throw Error("No Stripe payment in prelaunch rendering"); } },
    "@/components/membership/MembershipEntryProgress": { useMembershipEntryProgressStage() {} },
    "@/components/membership/RegistrationCouplePreference": { useRegistrationCouple: () => ({ loading: false, loadError: null }), RegistrationCoupleFields: () => null },
    "@/components/membership/CoupleMembershipApproval": Stub, "@/components/membership/AgreementText": Stub,
    "@/components/membership/MemberPhotoUpload": Stub, "@/components/membership/MemberPaymentMethod": Payment,
    "@/lib/membership/entry-stage": await load("src/lib/membership/entry-stage.ts"),
    "@/lib/membership/pricing": await load("src/lib/membership/pricing.ts"),
    "@/lib/membership/phone": await load("src/lib/membership/phone.ts"),
    "@/lib/membership/member-communication-preferences-model": await load("src/lib/membership/member-communication-preferences-model.ts"),
  })).default;
  const base = { checkoutEnabled: false, paymentSetupEnabled: true, enabled: true, disabledReason: null, checkoutDisabledReason: null, minimumAge: 18, photoStorageReady: false, publishableKey: null };
  const onboarding = { billingState: "pending", membershipFunding: "self", requiredFieldsComplete: true, agreement: { acceptanceId: null, id: null, body: null }, profile: {} };
  const render = change => renderToStaticMarkup(React.createElement(Join, { ...base, initialOnboarding: { ...onboarding, ...change } }));
  const html = render({});
  assert.match(html, /Your profile is ready/); assert.match(html, /data-optional-payment/);
  assert.doesNotMatch(html, /agreement not published|Entry remains closed|Accept &amp; continue|Membership payment/i);
  assert.doesNotMatch(render({ requiredFieldsComplete: false }), /data-optional-payment/);
  for (const funding of ["operator","complimentary"]) assert.doesNotMatch(render({ membershipFunding: funding }), /data-optional-payment/);
});

test("payment-method page uses entry access without a paid agreement and ignores preview-state requests on live accounts", async () => {
  let context = { state: "authenticated", data: { requiredFieldsComplete: true, agreement: { id: null } } };
  const Panel = () => null;
  const Page = (await load("app/my/payment-method/page.tsx", {
    "next/link": Link, "next/navigation": { redirect: href => { throw Object.assign(Error("redirect"), { href }); } },
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "@/lib/membership/registration-repository": { getMemberRegistration: async () => null },
    "@/lib/membership/registration-routing": await load("src/lib/membership/registration-routing.ts"),
    "@/lib/membership/preview-scenarios": { memberRegistrationPreview: () => null, memberPreviewScenario: () => "active" },
    "@/components/membership/MemberPaymentMethod": Panel,
    "@/components/membership/MemberSettingsHeader": Stub, "@/components/platform/PlatformUnavailable": Stub,
    "@/lib/membership/page-context": { getMembershipPageContext: async (_preview, _load, area) => { assert.equal(area,"payment-method"); return context; } },
    "@/lib/membership/preview": { PREVIEW_MEMBER_ONBOARDING: {} },
    "@/lib/membership/repository": { getMemberOnboarding: () => { throw Error("Never load a live member in a test"); } },
  })).default;
  const page = () => Page({ searchParams: Promise.resolve({ setup: "returned", view: "saved" }) });
  let panel = nodes(await page()).find(node => node.type === Panel);
  assert.equal(panel.props.preview,false); assert.equal(panel.props.initialPreviewState,"not_saved"); assert.equal(panel.props.returnState,"returned");
  context = { ...context, state: "preview" };
  panel = nodes(await page()).find(node => node.type === Panel);
  assert.equal(panel.props.preview,true); assert.equal(panel.props.initialPreviewState,"saved");
  context = { state: "signed_out", data: null };
  await assert.rejects(page,error => error.href === "/my/access");
});


test("new registration requires card setup without offering profile access or an optional bypass", async () => {
  const f = await fixture({ props: { registrationOnly: true, returnState: "cancelled" } });
  assert.match(text(f.render()), /Save your card to finish registration/);
  assert.doesNotMatch(text(f.render()), /optional|Do this later|Back to my account/i);
  assert.match(text(f.render()), /Registration does not open member access/);
  assert.equal(nodes(f.render()).some(node => node.props.href === "/my"), false);
  assert.ok(text(f.render()).includes(paymentModel.PAYMENT_SETUP_CONSENT_TEXT));
  assert.match(text(f.render()), /Eligible individuals who complete registration with a verified saved card lock in \$349\/month/);
  assert.match(text(f.render()), /Your receipt confirms any reserved rate\. Couples pricing is separate/);
  assert.doesNotMatch(text(f.render()), /or reserve an offer/);
  assert.equal(f.consent().props.checked, false);
  assert.equal(nodes(f.render()).some(node => node.props.href === "/my/registered"), false);
  assert.equal(nodes(f.render()).some(node => node.props.href === "/my/account"), false);
});

test("registration receipt link appears only after authoritative saved state, never a return query", async () => {
  const f = await fixture({ state: "pending", props: { registrationOnly: true, returnState: "returned" } });
  assert.equal(nodes(f.render()).some(node => node.props.href === "/my/registered"), false);
  f.setResponse(snapshot("saved")); await f.reload();
  assert.ok(nodes(f.render()).some(node => node.props.href === "/my/registered" && text(node) === "Continue to registration receipt"));
  assert.doesNotMatch(text(f.render()), /Your profile|Do this later/);
  f.button("Remove saved payment method").props.onClick();
  f.setResponse(snapshot()); await f.button("Remove payment method").props.onClick();
  assert.equal(nodes(f.render()).some(node => node.props.href === "/my/registered"), false);
  assert.match(text(f.render()), /Save a card again to finish registration/);
});

test("registration preview receipt remains clearly inert", async () => {
  const f = await fixture({ props: { registrationOnly: true, preview: true, initialPreviewState: "saved" } });
  assert.equal(f.calls.length, 0);
  assert.ok(nodes(f.render()).some(node => node.props.href === "/my/registered" && text(node) === "Preview registration receipt"));
  assert.match(text(f.render()), /no payment methods are saved or removed/);
});


test("Stripe return advances new registration only after saved confirmation; management and preview do not auto-navigate", async () => {
  const f = await fixture({ state: "pending", props: { registrationOnly: true, returnState: "returned" } });
  f.render(); f.receiptEffect(); assert.deepEqual(f.redirects, []);
  f.setResponse(snapshot("saved")); await f.reload(); f.render(); f.receiptEffect();
  assert.deepEqual(f.redirects, ["/my/registered"]);
  f.receiptEffect(); assert.equal(f.redirects.length, 1);
  for (const props of [{ registrationOnly: true }, { registrationOnly: false, returnState: "returned" }, { registrationOnly: true, returnState: "returned", preview: true, initialPreviewState: "saved" }]) {
    const separate = await fixture({ state: "saved", props }); separate.render(); separate.receiptEffect();
    assert.deepEqual(separate.redirects, []);
  }
});
