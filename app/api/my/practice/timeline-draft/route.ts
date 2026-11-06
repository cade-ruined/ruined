import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { resolvePlatformSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { JournalError } from "@/lib/membership/journal-model";
import { MembershipAccessDeniedError } from "@/lib/membership/repository";
import { PracticeError } from "@/lib/practice/model";
import { completePracticeTimelineResume } from "@/lib/practice/timeline-draft-handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });

async function readInput(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new PracticeError(415, "JSON is required.");
  const reader = request.body?.getReader();
  if (!reader) throw new PracticeError(400, "A saved entry is required.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); throw new PracticeError(413, "That request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new PracticeError(400, "A valid saved entry is required."); }
}

export async function POST(request: Request) {
  try {
    if (!isTrustedPlatformOrigin(request)) throw new PracticeError(403, "Request origin is not allowed.");
    if (getPlatformConfiguration().mode !== "connected") throw new PracticeError(503, "The Work is not connected.");
    const session = await resolvePlatformSession(await createSupabaseServerClient(), { verifyCurrentUser: true });
    if (session.status === "unavailable") throw new PracticeError(503, "The Work is temporarily unavailable.");
    if (session.status !== "authenticated") throw new PracticeError(401, "Sign in to continue your work.");
    const authUserId = session.viewer.authUserId;
    if (request.headers.get("x-ruined-session-owner") !== authUserId) throw new PracticeError(409, "The signed-in account changed. Reload before continuing.", "account_changed");
    return json(await completePracticeTimelineResume(authUserId, await readInput(request)));
  } catch (error) {
    if (error instanceof PracticeError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof JournalError) return json({ error: error.message }, error.status);
    if (error instanceof MembershipAccessDeniedError) return json({ error: "Your account cannot change this work." }, 403);
    console.error("Practice Timeline draft cleanup failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: "Your Timeline save is safe. The unfinished work could not be cleared yet." }, 503);
  }
}
