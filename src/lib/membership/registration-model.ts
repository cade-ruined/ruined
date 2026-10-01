export type MemberRegistrationSnapshot = {
  memberId: string;
  state: "collecting" | "registered" | "activated";
  registeredAt: string | null;
  profileActivatedAt: string | null;
  requiresPaymentMethod: boolean;
  profileComplete: boolean;
  ready: boolean;
  version: number;
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
