export type JournalKind = "text" | "images" | "video";
export type JournalMedia = { id: string; mimeType: string; size: number; url: string };
export type JournalEntry = {
  id: string; kind: JournalKind; title: string | null; body: string | null;
  createdAt: string; saved: boolean; media: JournalMedia[];
};
export type JournalSnapshot = { entries: JournalEntry[]; writable: boolean; mediaReady: boolean; hasMore: boolean };
export type JournalCreateInput = { id: string; kind: JournalKind; title: string; body: string; mediaIds: string[] };
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
  if (Object.keys(entry).some(key => !["id", "kind", "title", "body", "mediaIds"].includes(key)) ||
      typeof entry.id !== "string" || !JOURNAL_UUID.test(entry.id) ||
      !["text", "images", "video"].includes(String(entry.kind)) ||
      typeof entry.title !== "string" || entry.title.trim().length > 160 ||
      typeof entry.body !== "string" || entry.body.trim().length > JOURNAL_BODY_LENGTH ||
      !Array.isArray(entry.mediaIds) || entry.mediaIds.some(id => typeof id !== "string" || !JOURNAL_UUID.test(id)) ||
      new Set(entry.mediaIds).size !== entry.mediaIds.length) throw new JournalError(400, "Check the entry and try again.");
  const kind = entry.kind as JournalKind;
  if ((kind === "text" && (!entry.body.trim() || entry.mediaIds.length !== 0)) ||
      (kind === "images" && (entry.mediaIds.length < 1 || entry.mediaIds.length > JOURNAL_MAX_IMAGES)) ||
      (kind === "video" && entry.mediaIds.length !== 1)) throw new JournalError(400, "Add text, up to eight images, or one video.");
  return { id: entry.id, kind, title: entry.title.trim(), body: entry.body.trim(), mediaIds: entry.mediaIds as string[] };
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
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new JournalError(400, "A valid entry is required."); }
}
