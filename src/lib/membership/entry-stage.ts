export const MEMBERSHIP_ENTRY_STAGES = [
  { id: "profile", label: "Profile" },
  { id: "agreement", label: "Agreement" },
  { id: "payment", label: "Payment" },
] as const;

export type MembershipEntryStage = (typeof MEMBERSHIP_ENTRY_STAGES)[number]["id"];

export function membershipEntryStage(
  profileComplete: boolean,
  agreementComplete: boolean,
): MembershipEntryStage {
  if (!profileComplete) return "profile";
  if (!agreementComplete) return "agreement";
  return "payment";
}
