/** The only data shape allowed across the public member-card boundary. */
export type PublicMemberCard = {
  name: string;
  avatarUrl: string | null;
  memberSince: string | null;
  location: string | null;
  bio: string | null;
  buildingNow: string | null;
  websiteUrl: string | null;
  labels: string[];
  wearSeed: string;
};
export type MemberCardSettings = {
  publicEnabled: boolean;
  showPortrait: boolean;
  showMemberSince: boolean;
  showLocation: boolean;
  showBio: boolean;
  showBuilding: boolean;
  showWebsite: boolean;
  labelIds: string[];
};
export type MemberCardSource = {
  name: string;
  avatarUrl: string | null;
  memberSince: string | null;
  location: string | null;
  bio: string;
  buildingNow: string;
  websiteUrl: string;
};
export type MemberCardLabel = { id: string; label: string };
export type MemberCardSnapshot = {
  card: PublicMemberCard;
  settings: MemberCardSettings;
  version: number;
  writable: boolean;
  eligible: boolean;
  publicUrl: string | null;
  source: MemberCardSource;
  sourceRevision: string;
  availableLabels: MemberCardLabel[];
};
export type MemberCardInput = MemberCardSettings & { version: number };
export const MEMBER_CARD_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const MEMBER_CARD_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
} as const;
export const MEMBER_CARD_LIMITS = { name: 64, bio: 180, building: 100, website: 300, labels: 2 } as const;
const LABEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FLAGS = ["publicEnabled", "showPortrait", "showMemberSince", "showLocation", "showBio", "showBuilding", "showWebsite"] as const;
const FIELDS = [...FLAGS, "labelIds", "version"];
export class PublicCardError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "PublicCardError"; }
}
export function normalizeCardWebsite(value: string): string {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    if (url.href.length > MEMBER_CARD_LIMITS.website) throw new Error();
    return url.href;
  } catch { throw new PublicCardError(400, "Use a complete http or https website address."); }
}
export function validateMemberCardInput(value: unknown): MemberCardInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublicCardError(400, "A card is required.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !FIELDS.includes(key)) || FLAGS.some(key => typeof input[key] !== "boolean") ||
      !Number.isSafeInteger(input.version) || Number(input.version) < 0 || Number(input.version) > 2_147_483_646 ||
      !Array.isArray(input.labelIds) || input.labelIds.length > MEMBER_CARD_LIMITS.labels ||
      input.labelIds.some(id => typeof id !== "string" || !LABEL_ID.test(id)) || new Set(input.labelIds).size !== input.labelIds.length) {
    throw new PublicCardError(400, "Check your card choices and try again.");
  }
  return {
    publicEnabled: input.publicEnabled as boolean,
    showPortrait: input.showPortrait as boolean, showMemberSince: input.showMemberSince as boolean,
    showLocation: input.showLocation as boolean, showBio: input.showBio as boolean,
    showBuilding: input.showBuilding as boolean, showWebsite: input.showWebsite as boolean,
    labelIds: input.labelIds as string[], version: input.version as number,
  };
}
export function defaultMemberCardSettings(): MemberCardSettings {
  return {
    publicEnabled: false, showPortrait: false, showMemberSince: false, showLocation: false,
    showBio: false, showBuilding: false, showWebsite: false, labelIds: [],
  };
}
/** Used for owner drafts and public responses; never spreads a profile or identity. */
export function projectMemberCard(settings: MemberCardSettings, source: MemberCardSource, labels: MemberCardLabel[], wearSeed: string): PublicMemberCard {
  return {
    name: source.name,
    avatarUrl: settings.showPortrait ? source.avatarUrl : null,
    memberSince: settings.showMemberSince ? source.memberSince : null,
    location: settings.showLocation ? source.location : null,
    bio: settings.showBio ? source.bio || null : null,
    buildingNow: settings.showBuilding ? source.buildingNow || null : null,
    websiteUrl: settings.showWebsite ? source.websiteUrl || null : null,
    labels: settings.labelIds.map(id => labels.find(label => label.id === id)?.label).filter((label): label is string => !!label).slice(0, MEMBER_CARD_LIMITS.labels),
    wearSeed,
  };
}
/** Only print excerpts are shortened. Public details always retain the full shared profile. */
export function memberCardExcerpt(value: string | null, max: number): string | null {
  if (!value) return null;
  const segments = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), part => part.segment);
  return segments.length <= max ? value : `${segments.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
}
/** Applies to chunked requests too, before JSON parsing. */
export async function readMemberCardJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new PublicCardError(415, "JSON is required.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 8_000)) throw new PublicCardError(413, "That card is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new PublicCardError(400, "A card is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 8_000) { await reader.cancel(); throw new PublicCardError(413, "That card is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PublicCardError(400, "A valid card is required."); }
}
