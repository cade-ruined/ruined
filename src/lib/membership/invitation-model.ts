import type { PublicMemberCard } from "./public-card-model";

export type PublicMemberInvitation = { card: PublicMemberCard };
export type MemberInvitationSnapshot = PublicMemberInvitation & {
  enabled: boolean; eligible: boolean; writable: boolean;
  url: string | null; joinedCount: number; version: number;
};
export type MemberInvitationInput = { enabled: boolean; version: number };
export const MEMBER_INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const MEMBER_INVITATION_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer",
} as const;
export class MemberInvitationError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "MemberInvitationError"; }
}
export function validateMemberInvitationInput(value: unknown): MemberInvitationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberInvitationError(400, "Choose whether to share your invitation.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["enabled", "version"].includes(key)) || typeof input.enabled !== "boolean" ||
      !Number.isSafeInteger(input.version) || Number(input.version) < 0 || Number(input.version) > 2_147_483_646) {
    throw new MemberInvitationError(400, "Check your invitation choices and try again.");
  }
  return { enabled: input.enabled, version: input.version as number };
}
/** Explicit invitation consent covers only the current display name and chosen member tag. */
export function invitationCard(name: string, wearSeed: string, memberTag: string | null = null): PublicMemberCard {
  return { name: name.trim() || "Member", memberTag, wearSeed, avatarUrl: null, memberSince: null, location: null,
    bio: null, buildingNow: null, websiteUrl: null, labels: [] };
}
export async function readMemberInvitationJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new MemberInvitationError(415, "JSON is required.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 1024)) throw new MemberInvitationError(413, "That request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new MemberInvitationError(400, "An invitation choice is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 1024) { await reader.cancel(); throw new MemberInvitationError(413, "That request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MemberInvitationError(400, "A valid invitation choice is required."); }
}
