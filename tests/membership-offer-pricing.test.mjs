import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as pricing from "../src/lib/membership/pricing.ts";

async function load(relativePath, dependencies = {}) {
  const source = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "server-only") return {};
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

test("six approved prices share USD tax-exclusive arithmetic without granting eligibility", () => {
  const expected = {
    individual: { monthly: 49_900, annual: 499_000, monthlyMinimum: 598_800, annualSavings: 99_800 },
    founding_individual: { monthly: 34_900, annual: 349_000, monthlyMinimum: 418_800, annualSavings: 69_800 },
    couple: { monthly: 69_900, annual: 699_000, monthlyMinimum: 838_800, annualSavings: 139_800 },
  };
  assert.equal(Object.keys(pricing.MEMBERSHIP_OFFERS).length, 6);
  for (const [tier, amounts] of Object.entries(expected)) {
    for (const plan of ["monthly", "annual"]) {
      const offer = pricing.MEMBERSHIP_OFFERS[`${tier}_${plan}`];
      assert.equal(offer.amount, amounts[plan]);
      assert.equal(offer.currency, "usd");
      assert.equal(offer.taxBehavior, "exclusive");
      assert.equal(offer.market, "US");
      assert.equal(offer.initialTermMonths, 12);
      assert.equal(offer.initialTermPayments, plan === "monthly" ? 12 : 1);
      assert.equal(offer.initialTermAmount, plan === "monthly" ? amounts.monthlyMinimum : amounts.annual);
      assert.equal(offer.initialTermAmount, offer.amount * offer.initialTermPayments);
      assert.equal(offer.annualSavings, amounts.annualSavings);
      assert.equal(offer.annualDiscountEquivalentMonths, 2);
      assert.equal(amounts.annual, amounts.monthly * 10);
      assert.equal(offer.requiresEligibility, tier !== "individual");
      assert.equal(offer.earlyExitFee, undefined, "the catalog must not invent an early-exit calculation");
      assert.equal(offer.foundingSlot, undefined, "prices do not reserve or grant a founding place");
    }
  }
});

test("existing billing consent and public signup remain standard-individual only", async () => {
  assert.deepEqual(pricing.MEMBERSHIP_PLANS, {
    monthly: { amount: 49_900, currency: "usd", interval: "month", label: "Monthly" },
    annual: { amount: 499_000, currency: "usd", interval: "year", label: "Annual" },
  });
  const { isPublicMembershipSignup } = await load("src/lib/membership/public-signup.ts", {
    "@/lib/membership/pricing": pricing,
  });
  assert.equal(isPublicMembershipSignup({ plan: "monthly" }), true);
  assert.equal(isPublicMembershipSignup({ plan: "annual" }), true);
  for (const id of Object.keys(pricing.MEMBERSHIP_OFFERS)) {
    assert.equal(pricing.isMembershipBillingPlan(id), false);
    assert.equal(isPublicMembershipSignup({ plan: id }), false);
  }
  assert.equal(isPublicMembershipSignup({ plan: "monthly", tier: "founding_individual" }), false);
  assert.equal(isPublicMembershipSignup({ plan: "annual", tier: "couple" }), false);
  assert.equal(isPublicMembershipSignup({ plan: "monthly", amount: 34_900 }), false);
});

test("verified live price mapping covers all six offers and omits the retired annual price", async () => {
  const { LIVE_MEMBERSHIP_PRICE_IDS } = await load("src/lib/stripe/membership-catalog.ts");
  assert.deepEqual(Object.keys(LIVE_MEMBERSHIP_PRICE_IDS).sort(), Object.keys(pricing.MEMBERSHIP_OFFERS).sort());
  assert.equal(new Set(Object.values(LIVE_MEMBERSHIP_PRICE_IDS)).size, 6);
  assert.equal(LIVE_MEMBERSHIP_PRICE_IDS.individual_monthly, "price_1UJdWe4cnqzISerX5M3cmhmg");
  assert.equal(LIVE_MEMBERSHIP_PRICE_IDS.individual_annual, "price_1UKj3o4cnqzISerXU0XE4XqR");
  assert.ok(!Object.values(LIVE_MEMBERSHIP_PRICE_IDS).includes("price_1UJdWj4cnqzISerXbldILtgj"));
});
