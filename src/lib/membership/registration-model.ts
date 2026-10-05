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
