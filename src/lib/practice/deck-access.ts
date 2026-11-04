import "server-only";

import { isFoundationsAvailableToMember } from "@/lib/foundations/availability";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_IDENTITY } from "@/lib/membership/preview";
import { getMemberIdentity } from "@/lib/membership/repository";
import { isMyRuinedVisible } from "@/lib/platform/visibility";
import type { PracticeCourse } from "@/lib/practice/model";
import { isPracticeCourseReleased } from "@/lib/practice/repository";

export const PRACTICE_DECK_COURSES = ["f1", "f2", "f3", "f4", "time"] as const;

export const practiceDeckHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
};

type DeckAccess =
  | { allowed: true; course: PracticeCourse; ownerId: string | null }
  | { allowed: false; status: 401 | 403 | 404 };

/** Document routes and their resources each authorize before reading curriculum. */
export async function authorizePracticeDeck(rawCourse: string): Promise<DeckAccess> {
  if (!PRACTICE_DECK_COURSES.includes(rawCourse as PracticeCourse) || !isMyRuinedVisible()) {
    return { allowed: false, status: 404 };
  }
  const course = rawCourse as PracticeCourse;
  const context = await getMembershipPageContext(PREVIEW_MEMBER_IDENTITY, getMemberIdentity, "The Work");
  if (context.state === "signed_out") return { allowed: false, status: 401 };
  if (!context.data || !["authenticated", "preview"].includes(context.state)) return { allowed: false, status: 403 };
  const ownerId = context.state === "authenticated" ? context.viewer?.authUserId : null;
  if (context.state === "authenticated" && !ownerId) return { allowed: false, status: 401 };
  const policy = deriveMemberAccessPolicy(context.data);
  if (!memberCan(policy, "foundations.write") && !memberCan(policy, "foundations.revisit")) return { allowed: false, status: 403 };
  if (!await isFoundationsAvailableToMember(ownerId)) return { allowed: false, status: 403 };
  if (!await isPracticeCourseReleased(course, ownerId)) return { allowed: false, status: 403 };
  return { allowed: true, course, ownerId: ownerId ?? null };
}
