import { BADGE_COLLECTION_KEYS, badgeCollectionItem, type MemberBadgeCollection } from "./badge-collection-model";

/** Development display only. This fixture never grants or publishes an award. */
export const PREVIEW_BADGE_COLLECTION: MemberBadgeCollection = {
  ownerId: "badge-collection-preview",
  seenAt: null,
  badges: BADGE_COLLECTION_KEYS.map(key => {
    const target = key === "make-it-yours" ? 3 : key === "full-circle" ? 2 : key === "the-whole-month" ? 4 : key === "groundwork" ? 100 : 1;
    const earned = key === "make-it-yours" || key === "first-words";
    const progress = earned ? target : key === "groundwork" ? 35 : key === "full-circle" ? 1 : 0;
    return badgeCollectionItem(key, { target, progress, earnedAt: earned ? "2026-10-01T16:00:00.000Z" : null, publicVisible: key !== "first-words" });
  }),
};
