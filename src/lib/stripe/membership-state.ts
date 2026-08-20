export const MEMBERSHIP_CONTEXT = "membership";
export const MEMBERSHIP_OFFER = "founding_membership";

export type MembershipState =
  | "pending"
  | "active"
  | "attention_required"
  | "ended";

export type StripeSubscriptionState =
  | "active"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "paused"
  | "trialing"
  | "unpaid";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

export function deriveMembershipState({
  paidInvoice,
  previousState,
  subscriptionState,
}: {
  paidInvoice: boolean;
  previousState: MembershipState;
  subscriptionState: StripeSubscriptionState;
}): MembershipState {
  if (subscriptionState === "canceled" || subscriptionState === "incomplete_expired") {
    return "ended";
  }

  if (
    subscriptionState === "past_due" ||
    subscriptionState === "paused" ||
    subscriptionState === "unpaid"
  ) {
    return "attention_required";
  }

  if (
    paidInvoice &&
    (subscriptionState === "active" || subscriptionState === "trialing")
  ) {
    return "active";
  }

  if (
    previousState === "active" &&
    (subscriptionState === "active" || subscriptionState === "trialing")
  ) {
    return "active";
  }

  if (
    previousState === "attention_required" &&
    (subscriptionState === "active" ||
      subscriptionState === "trialing" ||
      subscriptionState === "incomplete")
  ) {
    return "attention_required";
  }

  if (previousState === "ended") {
    return "ended";
  }

  return "pending";
}

export function applyBillingGuardrails({
  hasOperationalProblem,
  state,
}: {
  hasOperationalProblem: boolean;
  state: MembershipState;
}): MembershipState {
  if (state === "ended") return "ended";
  return hasOperationalProblem ? "attention_required" : state;
}

export function unixSecondsToDate(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value * 1_000) : null;
}
