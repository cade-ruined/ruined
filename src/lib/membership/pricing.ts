export type MembershipBillingPlan = "monthly" | "annual";

export const MEMBERSHIP_PLANS = {
  monthly: { amount: 49_900, currency: "usd", interval: "month", label: "Monthly" },
  annual: { amount: 504_000, currency: "usd", interval: "year", label: "Annual" },
} as const;

export function isMembershipBillingPlan(value: unknown): value is MembershipBillingPlan {
  return value === "monthly" || value === "annual";
}

export function formatMembershipPrice(amountCents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(amountCents / 100);
}
