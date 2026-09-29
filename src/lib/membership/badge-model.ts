import { memberTier } from "./member-number";

export const MEMBERSHIP_BADGES = {
  "early-supporter": {
    label: "I Was Here",
    description: "Joined the waitlist, then activated a Founders or Originals membership.",
  },
} as const;

export type MemberBadgeKey = keyof typeof MEMBERSHIP_BADGES;
export type MemberBadge = {
  key: MemberBadgeKey;
  label: string;
  description: string;
  earnedAt: string;
};

/** Server-verified membership and waitlist facts. */
export type MembershipBadgeFacts = {
  /** Assigned by completed membership activation, never accepted from a client. */
  memberNumber: number | null;
  activatedAt: string | null;
  verifiedEmail: string | null;
  waitlistEmail: string | null;
  waitlistedAt: string | null;
  /** Authoritative current paid or complimentary entitlement, not profile creation. */
  membershipActive: boolean;
};

export function memberBadge(key: string, earnedAt: string): MemberBadge | null {
  if (!Object.hasOwn(MEMBERSHIP_BADGES, key) || !Number.isFinite(Date.parse(earnedAt))) return null;
  const badgeKey = key as MemberBadgeKey;
  return { key: badgeKey, ...MEMBERSHIP_BADGES[badgeKey], earnedAt: new Date(earnedAt).toISOString() };
}

export function evaluateMembershipBadges(facts: MembershipBadgeFacts): MemberBadge[] {
  const tier = memberTier(facts.memberNumber);
  const activatedAt = facts.activatedAt ? Date.parse(facts.activatedAt) : NaN;
  const verifiedEmail = facts.verifiedEmail?.trim().toLowerCase();
  const waitlistEmail = facts.waitlistEmail?.trim().toLowerCase();
  const waitedAt = facts.waitlistedAt ? Date.parse(facts.waitlistedAt) : NaN;
  if (!tier || (tier.label !== "Founders" && tier.label !== "Originals") || !Number.isFinite(activatedAt)
      || !verifiedEmail || !waitlistEmail || verifiedEmail !== waitlistEmail
      || !Number.isFinite(waitedAt) || waitedAt >= activatedAt
      || facts.membershipActive !== true) return [];
  const badge = memberBadge("early-supporter", facts.activatedAt!);
  return badge ? [badge] : [];
}
