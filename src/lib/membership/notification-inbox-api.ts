import "server-only";

import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { resolvePlatformSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { MEMBER_NOTIFICATION_UUID, MemberNotificationError, type MemberAnnouncementAction } from "./notification-inbox-model";
import { acknowledgeMemberAnnouncement, getMemberNotificationState } from "./notification-inbox-repository";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, x-ruined-session-owner",
  "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function currentOwner(request: Request, ownerHeaderRequired: boolean): Promise<string> {
  if (getPlatformConfiguration().mode !== "connected") throw new MemberNotificationError(503, "Member updates are not connected.");
  const session = await resolvePlatformSession(await createSupabaseServerClient(), { verifyCurrentUser: true });
  if (session.status === "unavailable") throw new MemberNotificationError(503, "Member updates are temporarily unavailable.");
  if (session.status !== "authenticated") throw new MemberNotificationError(401, "Sign in to open your updates.");
  const expectedOwner = request.headers.get("x-ruined-session-owner");
  if ((ownerHeaderRequired || expectedOwner !== null) && expectedOwner !== session.viewer.authUserId) {
    throw new MemberNotificationError(409, "The signed-in account changed. Reload to open your updates.");
  }
  return session.viewer.authUserId;
}

async function readAction(request: Request): Promise<{ ownerId: string; notificationId: string; action: MemberAnnouncementAction }> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new MemberNotificationError(415, "JSON is required.");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 512)) throw new MemberNotificationError(413, "That request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new MemberNotificationError(400, "Choose a valid announcement action.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 512) { await reader.cancel(); throw new MemberNotificationError(413, "That request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MemberNotificationError(400, "Choose a valid announcement action."); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3
    || !("ownerId" in value) || typeof value.ownerId !== "string" || !MEMBER_NOTIFICATION_UUID.test(value.ownerId)
    || !("notificationId" in value) || typeof value.notificationId !== "string" || !MEMBER_NOTIFICATION_UUID.test(value.notificationId)
    || !("action" in value) || (value.action !== "dismiss" && value.action !== "open")) {
    throw new MemberNotificationError(400, "Choose a valid announcement action.");
  }
  return { ownerId: value.ownerId, notificationId: value.notificationId, action: value.action };
}

export async function handleMemberNotificationState(request: Request) {
  try {
    const ownerId = await currentOwner(request, true);
    return json(await getMemberNotificationState(ownerId));
  } catch (error) { return failure(error); }
}

export async function handleMemberAnnouncement(request: Request) {
  try {
    if (!isTrustedPlatformOrigin(request)) throw new MemberNotificationError(403, "Request origin is not allowed.");
    const ownerId = await currentOwner(request, false);
    const action = await readAction(request);
    if (action.ownerId !== ownerId) throw new MemberNotificationError(409, "The signed-in account changed. Reload to open your updates.");
    await acknowledgeMemberAnnouncement(ownerId, action.notificationId, action.action);
    return json({ ok: true, ownerId });
  } catch (error) { return failure(error); }
}

function failure(error: unknown) {
  if (error instanceof MemberNotificationError) return json({ error: error.message }, error.status);
  console.error("Member notification request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return json({ error: "Member updates are temporarily unavailable. Try again." }, 503);
}
