import { MEMBERSHIP_BADGES, type MemberBadgeKey } from "./badge-model";

export type BadgeCollectionItem = {
  key: string;
  label: string;
  description: string;
  earnedAt: string | null;
  progress: number;
  target: number;
  progressLabel: string;
  publicVisible: boolean;
  privateByDefault: boolean;
  actionHref: string | null;
};
export type MemberBadgeCollection = { ownerId: string; seenAt: string | null; badges: BadgeCollectionItem[] };

export const BADGE_COLLECTION_KEYS = [
  "make-it-yours", "first-words", "your-story", "on-the-record", "groundwork",
  "in-the-room", "full-circle", "the-whole-month", "open-door", "in-real-life", "one-year",
] as const satisfies readonly MemberBadgeKey[];

const ACTIONS: Record<(typeof BADGE_COLLECTION_KEYS)[number], string | null> = {
  "make-it-yours": "/my/profile", "first-words": "/my#journal",
  "your-story": "/my/foundations/timeline", "on-the-record": "/my#timeline",
  groundwork: "/my/foundations", "in-the-room": "/my/experiences", "full-circle": "/my/circle",
  "the-whole-month": "/my/experiences", "open-door": "/my/invitation", "in-real-life": "/my/experiences",
  "one-year": null,
};

export function badgeProgressLabel(key: string, progress: number, target: number): string {
  if (progress >= target) return "Earned";
  if (key === "make-it-yours") return `${progress} of 3 profile details`;
  if (key === "full-circle") return `${progress} of 2 Circle calls in one month`;
  if (key === "the-whole-month") return `${progress} of 4 calls in one topic month`;
  if (key === "groundwork") return `${progress}% complete`;
  if (key === "one-year") return "One year from registration";
  return "Not yet earned";
}

export function badgeCollectionItem(key: MemberBadgeKey, facts: {
  progress: number; target: number; earnedAt: string | null; publicVisible: boolean;
}): BadgeCollectionItem {
  const target = Math.max(1, facts.target);
  const progress = Math.max(0, Math.min(target, facts.progress));
  return { key, ...MEMBERSHIP_BADGES[key], ...facts, target, progress,
    progressLabel: badgeProgressLabel(key, progress, target), privateByDefault: key === "first-words",
    actionHref: key === "early-supporter" ? null : ACTIONS[key] };
}
