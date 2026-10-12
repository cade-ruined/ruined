import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { MemberCommunicationPreferencesError } from "@/lib/membership/member-communication-preferences";
import { getMemberEmailPreference, saveMemberEmailPreference } from "@/lib/membership/member-email-preferences-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
async function readInput(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new MemberCommunicationPreferencesError(415, "JSON is required.");
  if (Number(request.headers.get("content-length")) > 4096) throw new MemberCommunicationPreferencesError(413, "That request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new MemberCommunicationPreferencesError(400, "Choose your email reminder preference.");
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
    throw new MemberCommunicationPreferencesError(400, "Choose your email reminder preference.");
  } finally { reader.releaseLock(); }
}
async function handle(request: Request, write: boolean) {
  if (write && !isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  if (getPlatformConfiguration().mode !== "connected") return json({ error: "Email preferences are not connected." }, 503);
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return json({ error: "Sign in to manage email reminders." }, 401);
    return json(write ? await saveMemberEmailPreference(viewer.authUserId, await readInput(request)) : await getMemberEmailPreference(viewer.authUserId));
  } catch (error) {
    if (error instanceof MemberCommunicationPreferencesError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
    console.error("Member email preferences unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: "Your email preferences could not be saved or loaded. Please try again." }, 503);
  }
}
export function GET(request: Request) { return handle(request, false); }
export function PATCH(request: Request) { return handle(request, true); }
