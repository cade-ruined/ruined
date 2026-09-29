export type MembershipBillingPlan = "monthly" | "annual";
export type MembershipOfferTier = "individual" | "founding_individual" | "couple";
export type MembershipOfferId = `${MembershipOfferTier}_${MembershipBillingPlan}`;

function membershipOffer(tier: MembershipOfferTier, plan: MembershipBillingPlan, monthlyAmount: number) {
  const annual = plan === "annual";
  return {
    id: `${tier}_${plan}` as MembershipOfferId,
    tier,
    plan,
    amount: monthlyAmount * (annual ? 10 : 1),
    currency: "usd" as const,
    interval: annual ? "year" as const : "month" as const,
    taxBehavior: "exclusive" as const,
    market: "US" as const,
    paymentTiming: annual ? "annual_upfront" as const : "monthly_installments" as const,
    initialTermMonths: 12,
    initialTermPayments: annual ? 1 : 12,
    initialTermAmount: monthlyAmount * (annual ? 10 : 12),
    annualSavings: monthlyAmount * 2,
    annualDiscountEquivalentMonths: 2,
    requiresEligibility: tier !== "individual",
  };
}

/** Catalog facts only. The commercial repository grants founding eligibility and
 * reserves couple access; Checkout binds that server-issued offer to paid consent.
 */
export const MEMBERSHIP_OFFERS = {
  individual_monthly: membershipOffer("individual", "monthly", 49_900),
  individual_annual: membershipOffer("individual", "annual", 49_900),
  founding_individual_monthly: membershipOffer("founding_individual", "monthly", 34_900),
  founding_individual_annual: membershipOffer("founding_individual", "annual", 34_900),
  couple_monthly: membershipOffer("couple", "monthly", 69_900),
  couple_annual: membershipOffer("couple", "annual", 69_900),
} as const satisfies Record<MembershipOfferId, ReturnType<typeof membershipOffer>>;

/** Compatibility API for the existing standard-individual flow and stored billing consent. */
export const MEMBERSHIP_PLANS = {
  monthly: { amount: MEMBERSHIP_OFFERS.individual_monthly.amount, currency: "usd", interval: "month", label: "Monthly" },
  annual: { amount: MEMBERSHIP_OFFERS.individual_annual.amount, currency: "usd", interval: "year", label: "Annual" },
} as const;

export function isMembershipBillingPlan(value: unknown): value is MembershipBillingPlan {
  return value === "monthly" || value === "annual";
}

export function formatMembershipPrice(amountCents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(amountCents / 100);
}
