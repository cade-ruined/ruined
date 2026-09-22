export type JournalKind = "text" | "images" | "video";
export type JournalMedia = { id: string; mimeType: string; size: number; url: string };
export type JournalEntry = {
  id: string; kind: JournalKind; title: string | null; body: string | null;
  createdAt: string; saved: boolean; media: JournalMedia[];
  eventYear: number | null; eventMonth: number | null; eventDay: number | null;
  includeOnTimeline: boolean; version: string;
};
export type JournalSnapshot = { entries: JournalEntry[]; writable: boolean; mediaReady: boolean; hasMore: boolean; nextCursor?: string | null; total?: number; years?: number[] };
export type JournalCreateInput = { id: string; kind: JournalKind; title: string; body: string; mediaIds: string[]; eventYear?: number | null; eventMonth?: number | null; eventDay?: number | null; includeOnTimeline?: boolean };
export type JournalEditInput = Omit<JournalCreateInput, "id"> & { expectedVersion: string };
export type JournalListOptions = { view?: "journal" | "timeline"; search?: string; year?: number | null; order?: "oldest" | "newest" };
export const JOURNAL_MAX_IMAGES = 8;
export const JOURNAL_IMAGE_BYTES = 8 * 1024 * 1024;
export const JOURNAL_VIDEO_BYTES = 50 * 1024 * 1024;
export const JOURNAL_BODY_LENGTH = 20_000;
export const JOURNAL_MEDIA_ACCEPT = { images: "image/jpeg,image/png,image/webp", video: "video/mp4,video/webm" };
export const JOURNAL_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } as const;
export const JOURNAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class JournalError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "JournalError"; }
}
export function journalFilePolicy(mime: string, size: number) {
  const image = JOURNAL_MEDIA_ACCEPT.images.split(",").includes(mime);
  const video = JOURNAL_MEDIA_ACCEPT.video.split(",").includes(mime);
  if (!image && !video) throw new JournalError(415, "Choose JPG, PNG, WebP, MP4, or WebM.");
  if (!Number.isSafeInteger(size) || size < 1 || size > (image ? JOURNAL_IMAGE_BYTES : JOURNAL_VIDEO_BYTES)) {
    throw new JournalError(413, image ? "Choose images under 8 MB each." : "Choose a video under 50 MB.");
  }
  return image ? "images" as const : "video" as const;
}
export function validateJournalInput(value: unknown): JournalCreateInput {
  if (!value || typeof value !== "object") throw new JournalError(400, "An entry is required.");
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).some(key => !["id", "kind", "title", "body", "mediaIds", "eventYear", "eventMonth", "eventDay", "includeOnTimeline"].includes(key)) ||
      typeof entry.id !== "string" || !JOURNAL_UUID.test(entry.id) ||
      !["text", "images", "video"].includes(String(entry.kind)) ||
      typeof entry.title !== "string" || entry.title.trim().length > 200 ||
      typeof entry.body !== "string" || entry.body.trim().length > JOURNAL_BODY_LENGTH ||
      !Array.isArray(entry.mediaIds) || entry.mediaIds.some(id => typeof id !== "string" || !JOURNAL_UUID.test(id)) ||
      new Set(entry.mediaIds).size !== entry.mediaIds.length) throw new JournalError(400, "Check the entry and try again.");
  const kind = entry.kind as JournalKind;
  if ((kind === "text" && ((!entry.body.trim() && !entry.title.trim()) || entry.mediaIds.length !== 0)) ||
      (kind === "images" && (entry.mediaIds.length < 1 || entry.mediaIds.length > JOURNAL_MAX_IMAGES)) ||
      (kind === "video" && entry.mediaIds.length !== 1)) throw new JournalError(400, "Add text, up to eight images, or one video.");
  const eventYear = entry.eventYear ?? null;
  const eventMonth = entry.eventMonth ?? null;
  const eventDay = entry.eventDay ?? null;
  if ((eventYear !== null && (!Number.isInteger(eventYear) || Number(eventYear) < 1900 || Number(eventYear) > 2200))
      || (eventMonth !== null && (eventYear === null || !Number.isInteger(eventMonth) || Number(eventMonth) < 1 || Number(eventMonth) > 12))
      || (eventDay !== null && (eventMonth === null || !Number.isInteger(eventDay) || Number(eventDay) < 1
        || Number(eventDay) > new Date(Date.UTC(Number(eventYear), Number(eventMonth), 0)).getUTCDate()))
      || (entry.includeOnTimeline !== undefined && typeof entry.includeOnTimeline !== "boolean")) {
    throw new JournalError(400, "Choose a valid year, month and day, or leave the date blank.");
  }
  if (entry.includeOnTimeline && (eventYear === null || !entry.title.trim())) throw new JournalError(400, "Add a year and title to include this entry on your timeline.");
  return { id: entry.id, kind, title: entry.title.trim(), body: entry.body.trim(), mediaIds: entry.mediaIds as string[],
    eventYear: eventYear as number | null, eventMonth: eventMonth as number | null, eventDay: eventDay as number | null,
    includeOnTimeline: entry.includeOnTimeline === true };
}
export function validateJournalVersion(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value)) throw new JournalError(409, "Load the latest entry before saving. Your draft has not been changed.");
  return value;
}
export function validateJournalEdit(value: unknown, id: string): JournalEditInput {
  if (!value || typeof value !== "object") throw new JournalError(400, "An entry is required.");
  const { action, expectedVersion, ...fields } = value as Record<string, unknown>;
  if (action !== "edit" || !["kind", "title", "body", "mediaIds", "eventYear", "eventMonth", "eventDay", "includeOnTimeline"].every(key => Object.hasOwn(fields, key))) throw new JournalError(400, "A complete entry is required.");
  if (Object.hasOwn(fields, "id")) throw new JournalError(400, "The entry identifier cannot be changed.");
  const normalized = validateJournalInput({ ...fields, id });
  const { id: validatedId, ...input } = normalized;
  void validatedId;
  return { ...input, expectedVersion: validateJournalVersion(expectedVersion) };
}
/** Streaming limit applies even when Content-Length is absent or false. */
export async function readJournalJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new JournalError(415, "JSON is required.");
  const reader = request.body?.getReader();
  if (!reader) throw new JournalError(400, "An entry is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.length;
      if (size > 96_000) { await reader.cancel(); throw new JournalError(413, "That entry is too large."); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new JournalError(400, "A valid entry is required."); }
}
