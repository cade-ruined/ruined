import type { MemberTimelineEntry } from "../membership/model";

export const PRACTICE_COURSES = ["f1", "f2", "f3", "f4", "time"] as const;
export type PracticeCourse = (typeof PRACTICE_COURSES)[number];
export const PRACTICE_CATEGORIES = [
  { id: "sleep", label: "Sleep" }, { id: "work", label: "Work / business" },
  { id: "family", label: "Family / kids" }, { id: "relationship", label: "Relationship" },
  { id: "health", label: "Health" }, { id: "growth", label: "Personal growth" },
  { id: "community", label: "Friends / community" }, { id: "recreation", label: "Recreation" },
  { id: "media", label: "Phone / social / media" }, { id: "responsibilities", label: "Responsibilities" },
  { id: "unstructured", label: "Unstructured time" },
] as const;
export type PracticeCategory = (typeof PRACTICE_CATEGORIES)[number]["id"];
export type PracticeTimelineDraft = {
  id: string | null; year: number | null; month?: number | null;
  title: string; details: string; meaning: string; presentImpact: string;
  belief?: string | null; perspective?: string | null;
};
export type PracticeTimeFields = {
  action: string; category: PracticeCategory | ""; minutes: number;
  sourceCategory: PracticeCategory | ""; sourceMinutes: number;
};
export type PracticeBadge = { earned: boolean; earnedAt: string | null; completed: number; target: number };
export type PracticeSnapshot = {
  ownerId: string; revision: string; canWrite: boolean;
  releases: Record<PracticeCourse, boolean>;
  timeline: { entries: MemberTimelineEntry[]; revision: string; completeEntryIds: string[] };
  timelineDraft: PracticeTimelineDraft | null;
  lastTimelineEntryId: string | null;
  letter: { body: string; keptAt: string | null };
  time: PracticeTimeFields & { keptAt: string | null };
  badges: { f1: PracticeBadge; f4: PracticeBadge; time: PracticeBadge };
};
export type PracticeAction =
  | { action: "save_timeline_draft"; ownerId: string; expectedRevision: string; fields: PracticeTimelineDraft }
  | { action: "keep_timeline_entry"; ownerId: string; expectedRevision: string; expectedTimelineRevision: string; fields: PracticeTimelineDraft }
  | { action: "save_letter" | "keep_letter"; ownerId: string; expectedRevision: string; fields: { body: string } }
  | { action: "save_time" | "keep_time"; ownerId: string; expectedRevision: string; fields: PracticeTimeFields };

export class PracticeError extends Error {
  constructor(readonly status: number, message: string, readonly code = "practice_error") {
    super(message); this.name = "PracticeError";
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const keys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit && !value.includes("\u0000");
const category = (value: unknown): value is PracticeCategory | "" => value === "" || PRACTICE_CATEGORIES.some(item => item.id === value);
const minutes = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10080;
export const validPracticeRevision = (value: unknown): value is string => typeof value === "string" && /^\d{1,18}$/.test(value);

export function parsePracticeAction(value: unknown): PracticeAction {
  if (!object(value) || typeof value.action !== "string" || !text(value.ownerId, 36) || !UUID.test(value.ownerId)
    || !validPracticeRevision(value.expectedRevision)) throw new PracticeError(400, "A valid action is required.");
  const keepTimeline = value.action === "keep_timeline_entry";
  if (!keys(value, ["action", "ownerId", "expectedRevision", "fields"], keepTimeline ? ["expectedTimelineRevision"] : [])
    || (keepTimeline && !validPracticeRevision(value.expectedTimelineRevision)) || !object(value.fields)) {
    throw new PracticeError(400, "Load your latest saved work before continuing.");
  }
  const fields = value.fields;
  if (value.action === "save_timeline_draft" || keepTimeline) {
    if (!keys(fields, ["id", "year", "title", "details", "meaning", "presentImpact"], ["month", "belief", "perspective"])
      || !(fields.id === null || (typeof fields.id === "string" && UUID.test(fields.id)))
      || !(fields.year === null || (typeof fields.year === "number" && Number.isInteger(fields.year) && fields.year >= 1900 && fields.year <= 2200))
      || !(fields.month === undefined || fields.month === null || (typeof fields.month === "number" && Number.isInteger(fields.month) && fields.month >= 1 && fields.month <= 12))
      || !text(fields.title, 200) || !text(fields.details, fields.id ? 20000 : 4000)
      || !text(fields.meaning, 4000) || !text(fields.presentImpact, 4000)
      || !["belief", "perspective"].every(key => fields[key] === undefined || fields[key] === null || text(fields[key], 4000))) {
      throw new PracticeError(400, "Check your timeline entry. Your answers have not been changed.");
    }
    if (keepTimeline && (fields.year === null || !fields.title.trim() || !fields.meaning.trim() || !fields.presentImpact.trim())) {
      throw new PracticeError(400, "Add the year, what happened, what it meant, and how it shaped you.");
    }
  } else if (value.action === "save_letter" || value.action === "keep_letter") {
    if (!keys(fields, ["body"]) || !text(fields.body, 20000)) throw new PracticeError(400, "Your letter must be 20,000 characters or fewer.");
    if (value.action === "keep_letter" && !fields.body.trim()) throw new PracticeError(400, "Write your letter before keeping it.");
  } else if (value.action === "save_time" || value.action === "keep_time") {
    if (!keys(fields, ["action", "category", "minutes", "sourceCategory", "sourceMinutes"])
      || !text(fields.action, 2000) || !category(fields.category) || !category(fields.sourceCategory)
      || !minutes(fields.minutes) || !minutes(fields.sourceMinutes)) throw new PracticeError(400, "Use a valid action, area, and whole number of minutes.");
    if (value.action === "keep_time" && (!fields.action.trim() || !fields.category || !fields.sourceCategory
      || fields.category === fields.sourceCategory || fields.minutes <= 0 || fields.minutes > fields.sourceMinutes)) {
      throw new PracticeError(400, "Choose your action and fund its time from a different area of your week.");
    }
  } else throw new PracticeError(400, "That action is not supported.");
  return value as PracticeAction;
}

/** Preview never borrows account records or grants a real achievement. */
export function previewPracticeSnapshot(now: Date = new Date()): PracticeSnapshot {
  return {
    ownerId: "preview", revision: "0", canWrite: false,
    releases: { f1: true, f2: false, f3: false, f4: false, time: now.getTime() >= Date.parse("2026-12-01T07:00:00Z") },
    timeline: { entries: [], revision: "0", completeEntryIds: [] }, timelineDraft: null, lastTimelineEntryId: null,
    letter: { body: "", keptAt: null },
    time: { action: "", category: "", minutes: 0, sourceCategory: "", sourceMinutes: 0, keptAt: null },
    badges: { f1: { earned: false, earnedAt: null, completed: 0, target: 3 }, f4: { earned: false, earnedAt: null, completed: 0, target: 1 }, time: { earned: false, earnedAt: null, completed: 0, target: 2 } },
  };
}
