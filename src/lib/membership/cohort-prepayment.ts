import "server-only";

/** New offers only. Existing accepted schedules always use their stored terms. */
export function isMembershipCohortPrepaymentEnabled(): boolean {
  return process.env.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED?.trim().toLowerCase() === "true";
}
