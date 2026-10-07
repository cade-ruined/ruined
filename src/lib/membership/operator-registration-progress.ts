import type { MemberRegistrationSnapshot } from "./registration-model";

/** Operator presentation only. These values never authorize access or billing. */
export type OperatorRegistrationProgress = Pick<MemberRegistrationSnapshot,
  "state" | "registeredAt" | "profileComplete" | "ready" | "requiresInitialPayment" | "requiresPaymentMethod" | "completionBasis"> & {
  emailVerified?: boolean;
  paymentMethodState: "saved" | "removed" | "missing";
  paymentConfirmed: boolean;
  billingArranged: boolean;
  checkoutStarted?: boolean;
  billingState: string;
  serviceStartsAt: string | null;
};

export type OperatorRegistrationStatus = {
  label: string;
  detail: string;
  next: string;
  actor: "Member" | "Operator" | "Support";
  attention: boolean;
};

export function operatorRegistrationStatus(row: OperatorRegistrationProgress): OperatorRegistrationStatus {
  const result = (label: string, detail: string, next: string, actor: OperatorRegistrationStatus["actor"] = "Member", attention = false) =>
    ({ label, detail, next, actor, attention });
  const profile = row.state === "activated" ? "Profile open" : row.registeredAt && row.ready ? "Registration complete · profile held" : "Registration incomplete";
  if (row.emailVerified === false) return result("Email confirmation needed", "Account invitation created", "Member confirms their email code.");
  if (!row.profileComplete) return result("Information needed", `${row.emailVerified ? "Email verified · " : ""}registration incomplete`, "Member completes their information and terms.");
  if (row.billingState === "ended") return result("Membership ended", profile, "Operator reviews any return arrangements.", "Operator");
  if (row.paymentConfirmed) {
    const start = row.serviceStartsAt && Number.isFinite(Date.parse(row.serviceStartsAt))
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" }).format(new Date(row.serviceStartsAt)) : null;
    return result("Payment received", `${profile}${start && row.billingState === "pending" ? ` · service starts ${start}` : ""}`,
      row.state === "activated" ? "No payment follow-up needed." : row.registeredAt && row.ready ? "Operator opens the profile when ready." : "Support confirms the remaining registration checkpoint.",
      row.registeredAt && row.ready || row.state === "activated" ? "Operator" : "Support");
  }
  if (!row.requiresInitialPayment && !row.requiresPaymentMethod) return result("Complimentary", `${profile} · no payment required`,
    row.state === "activated" ? "No payment follow-up needed." : row.registeredAt && row.ready ? "Operator opens the profile when ready." : "Member finishes complimentary registration.",
    row.registeredAt && row.ready || row.state === "activated" ? "Operator" : "Member");
  if (row.billingState === "attention_required" || row.completionBasis === "paid_membership") return result("Payment needs review", "Payment is not currently confirmed", "Support checks the payment or refund before asking the member to pay again.", "Support", true);
  if (row.billingArranged) return result("Billing arranged", `${profile} · payment not confirmed here`, "Review the billing schedule and payment confirmation; do not request a second payment.", "Support");
  if (row.checkoutStarted) return result("Checkout started", "Payment not yet confirmed", "Member resumes checkout. If they already submitted payment, Support checks confirmation before another attempt.");
  if (row.requiresInitialPayment) return result("First payment needed", "Information complete · registration incomplete", "Member accepts the membership agreement and completes checkout.");
  if (row.paymentMethodState !== "saved") return result("Card needed",
    row.paymentMethodState === "removed" ? `${row.registeredAt ? "Previously registered · " : ""}saved card removed` : "Information complete · no saved card",
    "Member saves a card to finish the original registration flow. This does not charge it.", "Member", row.paymentMethodState === "removed");
  if (!row.ready) return result("Registration needs review", "Card saved · registration not currently ready", "Support reviews the remaining registration checkpoint.", "Support", true);
  return result("Card saved · not charged", profile,
    "Member must review the agreement and authorize paid activation. A saved card is not a payment.", "Member");
}
