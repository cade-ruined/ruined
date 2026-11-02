import type { FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import type { MEMBERSHIP_OFFERS } from "@/lib/membership/pricing";

export const OPERATOR_MEMBERSHIP_AUTHORITY_VERSION = "operator-membership-authority-v1";
export const OPERATOR_MEMBERSHIP_AUTHORITY_TEXT = "I have this member’s authorization to accept the Ruined Membership Agreement on their behalf. I am the cardholder and authorize the payment shown and recurring renewals on this card under these terms.";
// Separate authority: the administrator records the member's instruction, and
// does not claim to own the member's saved payment method.
export const OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION = "operator-saved-payment-authority-v2";
export const OPERATOR_SAVED_PAYMENT_AUTHORITY_TEXT = "I have this member’s authorization to accept the Ruined Membership Agreement on their behalf and charge their saved payment method for the disclosed first membership payment and recurring renewals. I am recording their authorization as an administrator, not claiming to be the cardholder.";
export type OperatorSavedPaymentEvidence = {
  source: "operator_recorded_member_authorization";
  statement: string;
  reference?: string;
};
export type OperatorMembershipQuote = {
  id: string; expiresAt: string; firstChargeAt: string | null;
  billingSchedule: FoundationsBillingSchedule | null;
  offer: (typeof MEMBERSHIP_OFFERS)[keyof typeof MEMBERSHIP_OFFERS];
  agreement: { title: string; version: string; bodyText: string };
  memberName: string; actorName: string; publishableKey: string;
  reviewToken: string;
  buyoutCap: number;
};
export class OperatorMembershipError extends Error {
  constructor(message: string, public readonly status = 409, public readonly code?: string, public readonly plan?: "monthly" | "annual") { super(message); this.name = "OperatorMembershipError"; }
}
