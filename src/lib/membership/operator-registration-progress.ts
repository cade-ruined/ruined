import type { MemberRegistrationSnapshot } from "./registration-model";

/** Operator presentation only. These values never authorize access or billing. */
export type OperatorRegistrationProgress = Pick<MemberRegistrationSnapshot,
  "state" | "registeredAt" | "profileComplete" | "ready" | "requiresInitialPayment" | "requiresPaymentMethod" | "completionBasis"> & {
  emailVerified?: boolean;
  paymentMethodState: "saved" | "removed" | "missing";
  paymentConfirmed: boolean;
  /** Current checkout availability does not rewrite the original registration requirement. */
  paidCheckoutAvailable?: boolean;
  paymentNeedsReview?: boolean;
  billingArranged: boolean;
  checkoutStarted?: boolean;
  billingState: string;
  serviceStartsAt: string | null;
  emailVerifiedAt?: string | null;
  informationCollectedAt?: string | null;
  paymentInformationCollectedAt?: string | null;
  paymentReceivedAt?: string | null;
  profileGrantedAt?: string | null;
  profileGranted?: boolean;
  paymentExempt?: boolean;
  paymentByPartner?: boolean;
  historicalPaymentRecorded?: boolean;
};

export type MemberCheckpointKey = "email" | "information" | "payment_method" | "payment" | "profile";
export type MemberJourneyNextKey = "email" | "information" | "payment" | "profile" | "review" | "complete";
export type OperatorMemberJourney = {
  checkpoints: Array<{ key: MemberCheckpointKey; label: string; state: "complete" | "needed" | "not_required" | "review"; completedAt: string | null; detail?: string }>;
  next: { key: MemberJourneyNextKey; label: string; detail: string; actor: "Member" | "Operator" | "Support" };
  attention: string | null;
};

/** One presentation and follow-up model. Never grants access or authorizes money movement. */
export function operatorMemberJourney(row: OperatorRegistrationProgress): OperatorMemberJourney {
  const exempt = row.paymentExempt ?? (!row.requiresInitialPayment && !row.requiresPaymentMethod);
  const granted = row.profileGranted ?? row.state === "activated";
  const paymentReview = !exempt && (row.paymentNeedsReview || (!row.paymentConfirmed &&
    (row.completionBasis === "paid_membership" || row.historicalPaymentRecorded || row.billingArranged || row.billingState === "active")));
  const attention = row.billingState === "ended" ? "Membership has ended. Review any return arrangements."
    : row.billingState === "attention_required" ? "Membership billing needs attention. Check the existing payment before requesting another."
    : paymentReview ? row.historicalPaymentRecorded ? "A historical payment is recorded. Verify the current billing arrangement before requesting payment."
      : "Payment or billing confirmation needs review. Check for a pending payment, refund or adjustment before requesting another payment."
    : !exempt && row.paymentConfirmed && row.paymentMethodState === "removed" ? "The saved payment method was removed. Review future billing with the member."
    : null;
  const paid = row.paymentConfirmed;
  const collected = row.paymentMethodState === "saved" || paid;
  const checkpoints: OperatorMemberJourney["checkpoints"] = [
    { key: "email", label: "Email verified", state: row.emailVerified ? "complete" : "needed", completedAt: row.emailVerified ? row.emailVerifiedAt ?? null : null },
    { key: "information", label: "Registration info collected", state: row.profileComplete ? "complete" : "needed", completedAt: row.profileComplete ? row.informationCollectedAt ?? null : null },
    { key: "payment_method", label: "Payment information collected", state: exempt || row.paymentByPartner ? "not_required" : collected ? "complete" : "needed",
      completedAt: exempt || row.paymentByPartner ? null : collected ? row.paymentInformationCollectedAt ?? row.paymentReceivedAt ?? null : null,
      detail: exempt ? "Complimentary membership" : row.paymentByPartner ? "Shared billing is handled by their partner."
        : row.paymentMethodState === "saved" ? "Saved with Stripe. A saved card alone is not a payment."
        : paid ? "Collected through Stripe checkout." : row.paymentMethodState === "removed" ? "Previously saved payment method removed." : undefined },
    { key: "payment", label: "Payment received", state: exempt ? "not_required" : paid ? "complete" : paymentReview || row.billingState === "attention_required" ? "review" : "needed",
      completedAt: !exempt && paid ? row.paymentReceivedAt ?? null : null,
      detail: exempt ? "Complimentary membership" : row.paymentByPartner ? paid ? "Shared membership payment confirmed." : "Awaiting payment from their partner." : undefined },
    { key: "profile", label: "Profile access granted", state: granted ? "complete" : "needed", completedAt: granted ? row.profileGrantedAt ?? null : null,
      detail: granted && !row.profileGrantedAt ? "Existing profile access; original grant date not recorded." : undefined },
  ];
  let next: OperatorMemberJourney["next"];
  if (attention) next = { key: "review", label: "Review membership billing", detail: attention, actor: "Support" };
  else if (!row.emailVerified) next = { key: "email", label: "Confirm email", detail: "Member enters their email confirmation code.", actor: "Member" };
  else if (!row.profileComplete) next = { key: "information", label: "Complete registration information", detail: "Member finishes their information and registration terms at /my/join.", actor: "Member" };
  else if (!exempt && !paid) next = { key: "payment", label: row.paymentByPartner ? "Await shared membership payment" : "Complete membership checkout",
    detail: row.paymentByPartner ? "Their partner handles the shared membership checkout. Do not request a separate payment."
      : row.billingArranged ? "Review the existing billing arrangement before starting another checkout."
      : row.checkoutStarted ? "Member resumes their existing checkout. If they already submitted payment, check its confirmation before another attempt."
      : row.paidCheckoutAvailable === false ? "Paid checkout is not open. Keep the payment follow-up on hold."
      : "Member reviews the price and terms, then pays through Stripe at /my/activate. No separate card-saving step.", actor: "Member" };
  else if (!granted && (!row.registeredAt || !row.ready)) next = { key: "review", label: "Review registration completion", detail: "Payment is confirmed or not required, but registration is not ready for profile access. Check the remaining registration record.", actor: "Support" };
  else if (!granted) next = { key: "profile", label: "Grant profile access", detail: "An Administrator opens the profile when ready. This sends the profile-access email and does not charge the member.", actor: "Operator" };
  else next = { key: "complete", label: "Onboarding complete", detail: "All required checkpoints are complete.", actor: "Operator" };
  return { checkpoints, next, attention: attention ?? (next.key === "review" ? next.detail : null) };
}

export type OperatorRegistrationStatus = {
  category: "information" | "payment" | "paid" | "complimentary" | "review";
  label: string;
  detail: string;
  next: string;
  actor: "Member" | "Operator" | "Support";
  attention: boolean;
};

export function operatorRegistrationStatus(row: OperatorRegistrationProgress): OperatorRegistrationStatus {
  const result = (category: OperatorRegistrationStatus["category"], label: string, detail: string, next: string, actor: OperatorRegistrationStatus["actor"] = "Member", attention = false) =>
    ({ category, label, detail, next, actor, attention });
  const profile = row.state === "activated" ? "Profile open" : row.registeredAt && row.ready ? "Registration complete · profile held" : "Registration incomplete";
  if (row.emailVerified === false) return result("information", "Email confirmation needed", "Account invitation created", "Member confirms their email code.");
  if (!row.profileComplete) return result("information", "Information needed", `${row.emailVerified ? "Email verified · " : ""}registration incomplete`, "Member completes their information and terms.");
  if (row.billingState === "ended") return result("review", "Membership ended", profile, "Operator reviews any return arrangements.", "Operator");
  if (row.paymentConfirmed) {
    const start = row.serviceStartsAt && Number.isFinite(Date.parse(row.serviceStartsAt))
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" }).format(new Date(row.serviceStartsAt)) : null;
    return result("paid", "Payment received", `${profile}${start && row.billingState === "pending" ? ` · service starts ${start}` : ""}`,
      row.state === "activated" ? "No payment follow-up needed." : row.registeredAt && row.ready ? "Operator opens the profile when ready." : "Support confirms the remaining registration checkpoint.",
      row.registeredAt && row.ready || row.state === "activated" ? "Operator" : "Support");
  }
  if (!row.requiresInitialPayment && !row.requiresPaymentMethod) return result("complimentary", "Complimentary", `${profile} · no payment required`,
    row.state === "activated" ? "No payment follow-up needed." : row.registeredAt && row.ready ? "Operator opens the profile when ready." : "Member finishes complimentary registration.",
    row.registeredAt && row.ready || row.state === "activated" ? "Operator" : "Member");
  if (row.billingState === "attention_required" || row.completionBasis === "paid_membership" || row.paymentNeedsReview) return result("review", "Payment needs review", "Payment is not currently confirmed", "Support checks the payment or refund before asking the member to pay again.", "Support", true);
  if (row.billingArranged) return result("review", "Billing arranged", `${profile} · payment not confirmed here`, "Review the billing schedule and payment confirmation; do not request a second payment.", "Support");
  if (row.checkoutStarted) return result("payment", "Checkout started", "Payment not yet confirmed", "Member resumes checkout. If they already submitted payment, Support checks confirmation before another attempt.");
  if (row.requiresInitialPayment) return result("payment", "First payment needed", "Information complete · registration incomplete", "Member accepts the membership agreement and completes checkout.");
  if (row.paidCheckoutAvailable) return result("payment", "First payment needed",
    row.paymentMethodState === "saved" ? "Card saved · not charged" : row.paymentMethodState === "removed" ? "No payment received · saved card removed" : "Information complete · no payment received",
    "Member signs in at /my/activate to review the membership agreement and pay through Stripe. No separate card-saving step.");
  if (row.paymentMethodState !== "saved") return result("payment", "Card needed",
    row.paymentMethodState === "removed" ? `${row.registeredAt ? "Previously registered · " : ""}saved card removed` : "Information complete · no saved card",
    "Member saves a card to finish the original registration flow. This does not charge it.", "Member", row.paymentMethodState === "removed");
  if (!row.ready) return result("review", "Registration needs review", "Card saved · registration not currently ready", "Support reviews the remaining registration checkpoint.", "Support", true);
  return result("payment", "Card saved · not charged", profile,
    "Member must review the agreement and authorize paid activation. A saved card is not a payment.", "Member");
}
