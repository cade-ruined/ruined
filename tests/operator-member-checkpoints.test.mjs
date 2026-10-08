import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.equal(name, "react/jsx-runtime", "Checkpoint display must have no data access or actions");
    return require(name);
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}
const { operatorMemberJourney } = load("src/lib/membership/operator-registration-progress.ts");
const Checkpoints = load("src/components/platform/OperatorMemberCheckpoints.tsx").default;
const base = { state: "registered", registeredAt: "2026-10-07T18:00:00Z", profileComplete: true, ready: true,
  requiresInitialPayment: true, requiresPaymentMethod: false, completionBasis: "paid_membership", emailVerified: true,
  emailVerifiedAt: "2026-10-07T16:00:00Z", informationCollectedAt: null,
  paymentInformationCollectedAt: null, paymentReceivedAt: "2026-10-07T18:00:00Z", profileGrantedAt: null,
  paymentMethodState: "missing", paymentConfirmed: true, billingArranged: true, billingState: "pending", serviceStartsAt: null };
const render = (progress, compact = false) => renderToStaticMarkup(React.createElement(Checkpoints, { journey: progress ? operatorMemberJourney(progress) : null, compact }));

test("all five checkpoints use canonical labels and only known completion dates", () => {
  const html = render(base);
  for (const label of ["Email verified", "Registration info collected", "Payment information collected", "Payment received", "Profile access granted"]) assert.match(html, new RegExp(label));
  assert.equal((html.match(/<li /g) ?? []).length, 5);
  assert.equal((html.match(/<time /g) ?? []).length, 3, "Email and Stripe checkout evidence have dates; information and access do not");
  assert.match(html, /Collected through Stripe checkout/);
  assert.match(html, /Oct 7, 2026/);
  assert.doesNotMatch(html, /Invalid Date|undefined|NaN/);
});

test("completed checkpoints with no trustworthy timestamp do not receive fabricated dates", () => {
  const html = render({ ...base, state: "activated", emailVerifiedAt: null, informationCollectedAt: "invalid", paymentReceivedAt: null });
  assert.doesNotMatch(html, /<time /);
  assert.match(html, /Existing profile access; original grant date not recorded/);
  assert.match(html, /Profile access granted: Complete/);
});

test("compact display preserves accessible full labels, current states and dates", () => {
  const html = render(base, true);
  assert.match(html, /grid-cols-5/);
  assert.match(html, /aria-label="Payment received: Complete · Oct 7, 2026"/);
  assert.match(html, /aria-label="Profile access granted: Needed"/);
  assert.doesNotMatch(html, /<button|<a /, "Checkpoints do not trigger actions");
});

test("complimentary and review payment states cannot visually masquerade as a received payment", () => {
  const complimentary = render({ ...base, paymentExempt: true });
  assert.match(complimentary, /aria-label="Payment received: Not required"/);
  assert.doesNotMatch(complimentary, /aria-label="Payment received: Complete/);
  const review = render({ ...base, paymentConfirmed: false, paymentNeedsReview: true });
  assert.match(review, /aria-label="Payment received: Review"/);
  assert.doesNotMatch(review, /aria-label="Payment received: Complete/);
});

test("missing evidence stays unavailable rather than producing blank or completed checkpoints", () => {
  const html = render(null);
  assert.match(html, /Registration checkpoints are unavailable/);
  assert.doesNotMatch(html, /<li |Complete|Not required/);
});
