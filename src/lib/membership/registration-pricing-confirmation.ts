import type { RegistrationFoundingPricing } from "./registration-model";

/** Display only a persisted award. A card, plan preference, or member number is
 * not evidence of a confirmed rate. Shared by the receipt and welcome email. */
export function registrationFoundingConfirmation(pricing?: RegistrationFoundingPricing | null) {
  if (!pricing?.confirmed || pricing.currency !== "usd"
    || !Number.isSafeInteger(pricing.monthlyAmountCents) || pricing.monthlyAmountCents <= 0
    || !Number.isSafeInteger(pricing.annualAmountCents) || pricing.annualAmountCents <= 0) return null;
  const format = (amount: number) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(amount / 100);
  return {
    heading: "Your Founding rate is locked in.",
    monthly: `${format(pricing.monthlyAmountCents)}/month`,
    annual: `${format(pricing.annualAmountCents)}/year with annual billing.`,
    scope: "Individual membership. USD; applicable tax added at checkout.",
    retention: "Reserved for your first paid membership. Once it begins, your rate stays with you while that membership remains continuously active. If you leave, rejoining requires a new eligibility check.",
    payment: "Nothing has been charged. You’ll review your membership terms and confirm checkout before billing begins.",
  };
}
