import { isMembershipBillingPlan, type MembershipBillingPlan } from "@/lib/membership/pricing";

export type PublicMembershipSignup = { plan: MembershipBillingPlan };

/** A signup intent selects billing only. It cannot choose roles or funding. */
export function isPublicMembershipSignup(value: unknown): value is PublicMembershipSignup {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1 && "plan" in value && isMembershipBillingPlan(value.plan);
}
