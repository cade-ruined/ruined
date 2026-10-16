import { memberTier } from "./member-number";

export const MEMBERSHIP_BADGES = {
  "make-it-yours": { label: "Make It Yours", description: "Add your profile photo, bio, and member tag." },
  "first-words": { label: "First Words", description: "Write your first private journal entry." },
  "your-story": { label: "Your Story", description: "Complete your Foundations timeline." },
  "on-the-record": { label: "On the Record", description: "Publish your first public Timeline entry." },
  groundwork: { label: "Groundwork", description: "Complete Foundations." },
  "in-the-room": { label: "In the Room", description: "Attend your first confirmed membership call." },
  "full-circle": { label: "Full Circle", description: "Attend WHY and implementation with the same Circle in one month." },
  "the-whole-month": { label: "The Whole Month", description: "Attend SEE, FACE, CUT, and GROW in the same topic month." },
  "open-door": { label: "Open Door", description: "Invite someone who joins Ruined." },
  "in-real-life": { label: "In Real Life", description: "Attend your first confirmed in-person event." },
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
