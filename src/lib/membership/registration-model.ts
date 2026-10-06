import type { FoundationsBillingSchedule } from "./foundations-schedule";
import type { MembershipOfferId } from "./pricing";

export type RegistrationInitialPayment = {
  amountPaid: number;
  installmentDues: number;
  currency: "usd";
  plan: "monthly" | "annual";
  offerId: MembershipOfferId;
  billingSchedule: FoundationsBillingSchedule;
  paidAt: string;
  isPayer: boolean;
};

export type RegistrationFoundingPricing = {
  confirmed: true;
  awardedAt: string;
  monthlyAmountCents: number;
  annualAmountCents: number;
  currency: "usd";
};

export type MemberRegistrationSnapshot = {
  memberId: string;
  state: "collecting" | "registered" | "activated";
  registeredAt: string | null;
  profileActivatedAt: string | null;
  requiresPaymentMethod: boolean;
  requiresInitialPayment: boolean;
  completionBasis: "saved_card" | "complimentary" | "paid_membership" | null;
  initialPayment: RegistrationInitialPayment | null;
  profileComplete: boolean;
  ready: boolean;
  version: number;
  foundingPricing?: RegistrationFoundingPricing | null;
};

export type OpsMemberRegistration = MemberRegistrationSnapshot & {
  name: string;
  email: string;
  welcomeStatus: string | null;
  activationEmailStatus: string | null;
  coupleStatus?: "none" | "pending" | "paired";
  couplePartnerEmail?: string | null;
  couplePartnerMemberId?: string | null;
};
