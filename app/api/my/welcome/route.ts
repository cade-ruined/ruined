import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { resolvePlatformSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { MemberWelcomeError, type MemberWelcomeAction } from "@/lib/membership/welcome-model";
import { getMemberWelcome, updateMemberWelcome } from "@/lib/membership/welcome-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie",
  "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow",
};
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function welcomeViewer(request: Request): Promise<string> {
  if (getPlatformConfiguration().mode !== "connected") throw new MemberWelcomeError(503, "Member welcome is not connected.");
  const session = await resolvePlatformSession(await createSupabaseServerClient(), { verifyCurrentUser: true });
  if (session.status === "unavailable") throw new MemberWelcomeError(503, "Member welcome is temporarily unavailable.");
  if (session.status !== "authenticated") throw new MemberWelcomeError(401, "Sign in to open your profile.");
  const expectedOwner = request.headers.get("x-ruined-session-owner");
  if (expectedOwner && expectedOwner !== session.viewer.authUserId) throw new MemberWelcomeError(409, "The signed-in account changed. Reload your profile.");
  return session.viewer.authUserId;
}

function failure(error: unknown) {
  if (error instanceof MemberWelcomeError) return json({ error: error.message }, error.status);
  console.error("Member welcome request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return json({ error: "Member welcome is temporarily unavailable. Try again." }, 503);
}

async function readAction(request: Request): Promise<{ action: MemberWelcomeAction; ownerId: string }> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new MemberWelcomeError(415, "JSON is required.");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 512)) throw new MemberWelcomeError(413, "That request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new MemberWelcomeError(400, "Choose a valid welcome action.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 512) { await reader.cancel(); throw new MemberWelcomeError(413, "That request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MemberWelcomeError(400, "Choose a valid welcome action."); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2
    || !("action" in body) || typeof body.action !== "string" || !["dismiss", "resume", "calendar_viewed"].includes(body.action)
    || !("ownerId" in body) || typeof body.ownerId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.ownerId)) {
    throw new MemberWelcomeError(400, "Choose a valid welcome action.");
  }
  return { action: body.action as MemberWelcomeAction, ownerId: body.ownerId };
}

export async function GET(request: Request) {
  try {
    const authUserId = await welcomeViewer(request);
    return json(await getMemberWelcome(authUserId));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (!isTrustedPlatformOrigin(request)) throw new MemberWelcomeError(403, "Request origin is not allowed.");
    const authUserId = await welcomeViewer(request);
    const { action, ownerId } = await readAction(request);
    if (ownerId !== authUserId) return json({ code: "account_changed", error: "The signed-in account changed. Reload your profile." }, 409);
    return json(await updateMemberWelcome(authUserId, action));
  } catch (error) { return failure(error); }
}
