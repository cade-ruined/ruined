import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { resolvePlatformSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { BadgeNotificationError } from "@/lib/membership/badge-repository";
import { MembershipAccessDeniedError, MembershipConflictError, MembershipInputError } from "@/lib/membership/repository";
import { PracticeError } from "@/lib/practice/model";
import { getMemberPracticeSnapshot, saveMemberPractice } from "@/lib/practice/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie",
  "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function viewer(request: Request): Promise<string> {
  if (getPlatformConfiguration().mode !== "connected") throw new PracticeError(503, "Practice is not connected.");
  const session = await resolvePlatformSession(await createSupabaseServerClient(), { verifyCurrentUser: true });
  if (session.status === "unavailable") throw new PracticeError(503, "Practice is temporarily unavailable.");
  if (session.status !== "authenticated") throw new PracticeError(401, "Sign in to open your Practice.");
  const expectedOwner = request.headers.get("x-ruined-session-owner");
  if (expectedOwner && expectedOwner !== session.viewer.authUserId) throw new PracticeError(409, "The signed-in account changed. Reload before continuing.", "account_changed");
  return session.viewer.authUserId;
}

function failure(error: unknown) {
  if (error instanceof PracticeError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof BadgeNotificationError) return json({ error: error.message }, error.status);
  if (error instanceof MembershipAccessDeniedError) return json({ error: "Your membership does not currently include Practice access." }, 403);
  if (error instanceof MembershipConflictError) return json({ error: error.message, code: "timeline_revision_conflict" }, 409);
  if (error instanceof MembershipInputError) return json({ error: error.message }, 400);
  console.error("Member Practice request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return json({ error: "Your work could not be confirmed saved. Keep this page open and try loading your saved work." }, 503);
}

async function readAction(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new PracticeError(415, "JSON is required.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > 200000)) throw new PracticeError(413, "That Practice request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new PracticeError(400, "A Practice action is required.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 200000) { await reader.cancel(); throw new PracticeError(413, "That Practice request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new PracticeError(400, "A valid Practice action is required."); }
}

export async function GET(request: Request) {
  try { return json(await getMemberPracticeSnapshot(await viewer(request))); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (!isTrustedPlatformOrigin(request)) throw new PracticeError(403, "Request origin is not allowed.");
    const authUserId = await viewer(request);
    return json(await saveMemberPractice(authUserId, await readAction(request)));
  } catch (error) { return failure(error); }
}
