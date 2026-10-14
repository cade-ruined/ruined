import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { resolvePlatformSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { MemberCommunicationPreferencesError } from "@/lib/membership/member-communication-preferences";
import { getMemberSmsPreference, saveMemberSmsPreference } from "@/lib/membership/member-sms-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
async function readInput(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new MemberCommunicationPreferencesError(415, "JSON is required.");
  if (Number(request.headers.get("content-length")) > 4096) throw new MemberCommunicationPreferencesError(413, "That request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new MemberCommunicationPreferencesError(400, "Choose your text message preference.");
  const decoder = new TextDecoder(); let length = 0, text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new MemberCommunicationPreferencesError(413, "That request is too large."); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    if (error instanceof MemberCommunicationPreferencesError) throw error;
    throw new MemberCommunicationPreferencesError(400, "Choose your text message preference.");
  } finally { reader.releaseLock(); }
}
async function handle(request: Request, write: boolean) {
  if (write && !isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  if (getPlatformConfiguration().mode !== "connected") return json({ error: "Text preferences are not connected." }, 503);
  try {
    // getUser checks the current Auth identity as well as the JWT so a deleted
    // or banned user cannot save using an otherwise unexpired access token.
    const session = await resolvePlatformSession(await createSupabaseServerClient(), { verifyCurrentUser: true });
    if (session.status === "unavailable") return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
    if (session.status !== "authenticated") return json({ error: "Sign in to manage text messages." }, 401);
    return json(write ? await saveMemberSmsPreference(session.viewer.authUserId, await readInput(request))
      : await getMemberSmsPreference(session.viewer.authUserId));
  } catch (error) {
    if (error instanceof MemberCommunicationPreferencesError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
    console.error("Member text preferences unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: "Your text preferences could not be saved or loaded. Please try again." }, 503);
  }
}
export function GET(request: Request) { return handle(request, false); }
export function POST(request: Request) { return handle(request, true); }
