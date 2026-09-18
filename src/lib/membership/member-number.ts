export type MemberTier = {
  label: "Founders" | "Originals" | "Pillars" | "Builders" | "Members";
  displayNumber: string;
};

/** A tier is derived only from an assigned permanent membership number. */
export function memberTier(memberNumber: number | null | undefined): MemberTier | null {
  if (typeof memberNumber !== "number" || !Number.isSafeInteger(memberNumber) || memberNumber < 1) return null;
  return {
    label: memberNumber <= 5 ? "Founders" : memberNumber <= 50 ? "Originals" : memberNumber <= 100 ? "Pillars" : memberNumber <= 200 ? "Builders" : "Members",
    displayNumber: String(memberNumber).padStart(4, "0"),
  };
}
