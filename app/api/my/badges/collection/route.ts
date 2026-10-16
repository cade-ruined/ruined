import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { resolvePlatformSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { BadgeNotificationError } from "@/lib/membership/badge-repository";
import { getMemberBadgeCollection, markMemberBadgeCollectionSeen, setMemberBadgeVisibility } from "@/lib/membership/badge-collection-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie",
  "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function viewer(request: Request): Promise<string> {
  if (getPlatformConfiguration().mode !== "connected") throw new BadgeNotificationError(503, "Member badges are not connected.");
  const session = await resolvePlatformSession(await createSupabaseServerClient(), { verifyCurrentUser: true });
  if (session.status === "unavailable") throw new BadgeNotificationError(503, "Member badges are temporarily unavailable.");
  if (session.status !== "authenticated") throw new BadgeNotificationError(401, "Sign in to open your badges.");
  const expectedOwner = request.headers.get("x-ruined-session-owner");
  if (expectedOwner && expectedOwner !== session.viewer.authUserId) throw new BadgeNotificationError(409, "The signed-in account changed. Reload to open your badges.");
  return session.viewer.authUserId;
}

function failure(error: unknown) {
  if (error instanceof BadgeNotificationError) return json({ error: error.message }, error.status);
  console.error("Member badge collection request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return json({ error: "Member badges are temporarily unavailable. Try again." }, 503);
}

async function readAction(request: Request, action: "seen" | "visibility") {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new BadgeNotificationError(415, "JSON is required.");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 512)) throw new BadgeNotificationError(413, "That request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new BadgeNotificationError(400, "Choose a valid badge action.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 512) { await reader.cancel(); throw new BadgeNotificationError(413, "That request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: Record<string, unknown>;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new BadgeNotificationError(400, "Choose a valid badge action."); }
  const keys = action === "seen" ? ["action", "ownerId"] : ["action", "ownerId", "badgeKey", "visible"];
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== keys.length
      || !keys.every(key => Object.hasOwn(body, key)) || body.action !== action || typeof body.ownerId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.ownerId)
      || (action === "visibility" && (typeof body.badgeKey !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(body.badgeKey) || typeof body.visible !== "boolean"))) {
    throw new BadgeNotificationError(400, "Choose a valid badge action.");
  }
  return { ownerId: body.ownerId, badgeKey: body.badgeKey as string, visible: body.visible as boolean };
}

export async function GET(request: Request) {
  try { return json(await getMemberBadgeCollection(await viewer(request))); }
  catch (error) { return failure(error); }
}

async function write(request: Request, action: "seen" | "visibility") {
  try {
    if (!isTrustedPlatformOrigin(request)) throw new BadgeNotificationError(403, "Request origin is not allowed.");
    const authUserId = await viewer(request);
    const body = await readAction(request, action);
    if (body.ownerId !== authUserId) return json({ code: "account_changed", error: "The signed-in account changed. Reload to open your badges." }, 409);
    if (action === "seen") await markMemberBadgeCollectionSeen(authUserId);
    else await setMemberBadgeVisibility(authUserId, body.badgeKey, body.visible);
    return json({ ok: true, ownerId: authUserId });
  } catch (error) { return failure(error); }
}

export const POST = (request: Request) => write(request, "seen");
export const PATCH = (request: Request) => write(request, "visibility");
