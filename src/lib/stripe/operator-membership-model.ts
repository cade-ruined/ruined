import type { FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import type { MEMBERSHIP_OFFERS } from "@/lib/membership/pricing";

export const OPERATOR_MEMBERSHIP_AUTHORITY_VERSION = "operator-membership-authority-v1";
export const OPERATOR_MEMBERSHIP_AUTHORITY_TEXT = "I have this member’s authorization to accept the Ruined Membership Agreement on their behalf. I am the cardholder and authorize the payment shown and recurring renewals on this card under these terms.";
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
