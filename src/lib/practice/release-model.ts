import type { PracticeCourse } from "./model";

export const PRACTICE_RECAP_VERSION = 1;
export const PRACTICE_TIME_RELEASE_AT = "2026-12-01T07:00:00.000Z";
export type PracticeReleaseCourse = "f1" | "f4" | "time";
export const PRACTICE_RELEASE_COURSES = ["f1", "f4", "time"] as const;
export const isPracticeReleaseCourse = (value: unknown): value is PracticeReleaseCourse =>
  typeof value === "string" && (PRACTICE_RELEASE_COURSES as readonly string[]).includes(value);
export const PRACTICE_RECAPS = {
  f1: { title: "Foundations 1", subject: "Foundations 1 · Your next step", heading: "Your story. A place to begin.",
    paragraphs: ["In Foundations 1, we explored the Ruined philosophy, the experiences that shape us, and the difference between what happened and what we made it mean.", "The experience stays. We can get curious about the meaning we carry—and how it shapes the way we live."],
    assignment: "Add three entries to your timeline. Choose experiences that changed you, good or bad.",
    steps: ["What happened?", "What did I make it mean?", "How did that meaning shape me?"],
    closing: "Take them one at a time. Once you keep three complete entries, your F1 Badge is earned." },
  f4: { title: "Foundations 4", subject: "Foundations 4 · A letter to your future self", heading: "To the person you are becoming.",
    paragraphs: ["Foundations 4 brings what you have noticed into the way you want to live.", "A letter gives you a place to name what matters now and what you want to carry forward."],
    assignment: "Write a letter to your future self in Practice.", steps: ["Write what you want your future self to remember.", "Keep your letter when you are ready."],
    closing: "Keeping your letter earns your F4 Badge. Your letter stays private." },
  time: { title: "TIME", subject: "TIME · Make room for one thing", heading: "The same week. A different choice.",
    paragraphs: ["We all work within 168 hours. Making room for what matters begins by noticing where some of that time goes—and choosing what could change.", "You don’t need to rebuild your whole life. Begin with one thing."],
    assignment: "Choose one thing you want to make room for, then keep your time plan in MY 168.",
    steps: ["Name one concrete next step.", "Choose how much time it needs and where that time can come from.", "Keep the plan, then try that small change."],
    closing: "Keeping a plan for your chosen step earns your TIME Badge. You can return to adjust it whenever you need." },
} as const;
export const practiceAssignmentUrl = (course: PracticeCourse) => `https://members.theruinedproject.com/my/practice?course=${course}`;
export type PracticeReleaseReview = { token: string; kind: "assignment" | "deck"; title: string; course: PracticeCourse; eligible: number; excluded: number; expiresAt: string; subject: string; text: string };
export type PracticeReleaseItem = { course: PracticeReleaseCourse; title: string; releaseAt: string | null; releasedAt: string | null; source: string;
  counts: Record<string, number>; };
export type PracticeReleaseOverview = { items: PracticeReleaseItem[]; decks: Array<{ course: "f2" | "f3"; releaseAt: string | null; released: boolean }>; localEligible: number; localExcluded: number; deliveryReady: boolean; foundationsOpen: boolean; setupRequired: boolean };
export function practiceDeliveryMustStop(attempts: number, firstAttemptAt: string | Date | null, now = Date.now()) {
  return attempts > 5 || Boolean(firstAttemptAt && now - new Date(firstAttemptAt).getTime() >= 23 * 60 * 60_000);
}
