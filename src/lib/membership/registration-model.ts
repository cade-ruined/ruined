import type { FoundationsBillingSchedule } from "./foundations-schedule";
import type { MembershipOfferId } from "./pricing";
import type { OperatorRegistrationProgress } from "./operator-registration-progress";
import type { PersonalInvitationDeliveryStatus } from "./personal-invitation-model";

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

export type OpsRegistrationInvitation = {
  id: string;
  recipientName: string;
  recipientEmail: string | null;
  inviterName: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
  emailRequested: boolean;
  deliveryStatus: PersonalInvitationDeliveryStatus;
  sentAt: string | null;
  origin: "member" | "ruined_direct";
  membershipType: "standard" | "complimentary";
};

export type OpsMemberRegistration = MemberRegistrationSnapshot & {
  invitation?: OpsRegistrationInvitation | null;
  progress?: OperatorRegistrationProgress;
  name: string;
  email: string;
  welcomeStatus: string | null;
  activationEmailStatus: string | null;
  coupleStatus?: "none" | "pending" | "paired";
  couplePartnerEmail?: string | null;
  couplePartnerMemberId?: string | null;
};
