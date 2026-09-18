import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOwnMemberInvitation, saveOwnMemberInvitation } from "@/lib/membership/invitation-repository";
import { MEMBER_INVITATION_HEADERS, MemberInvitationError, readMemberInvitationJson, validateMemberInvitationInput } from "@/lib/membership/invitation-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { ...MEMBER_INVITATION_HEADERS, Vary: "Cookie" };
async function viewer(request: Request, write = false) {
  if (write && !isTrustedPlatformOrigin(request)) throw new MemberInvitationError(403, "Request origin is not allowed.");
  if (getPlatformConfiguration().mode !== "connected") throw new MemberInvitationError(503, "Your invitation is not connected.");
  const current = await getCurrentPlatformViewer();
  if (!current) throw new MemberInvitationError(401, "Sign in to open your invitation.");
  return current.authUserId;
}
function failure(error: unknown) {
  if (error instanceof MemberInvitationError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error("Member invitation request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "Your invitation is temporarily unavailable." }, { status: 503, headers });
}
export async function GET(request: Request) {
  try { return NextResponse.json({ snapshot: await getOwnMemberInvitation(await viewer(request)) }, { headers }); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const authUserId = await viewer(request, true);
    const input = validateMemberInvitationInput(await readMemberInvitationJson(request));
    return NextResponse.json({ snapshot: await saveOwnMemberInvitation(authUserId, input) }, { headers });
  } catch (error) { return failure(error); }
}
