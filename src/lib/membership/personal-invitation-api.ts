import { after, NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { MEMBER_INVITATION_HEADERS, MemberInvitationError, readMemberInvitationJson } from "./invitation-model";
import { validateCreatePersonalMemberInvitationInput } from "./personal-invitation-model";
import { getPersonalInvitationEmailReady, processPersonalInvitationEmailBatch } from "./personal-invitation-delivery";
import {
  createOwnPersonalInvitation, getOwnPersonalInvitations,
  revokeOwnPersonalInvitation, retryOwnPersonalInvitationEmail,
} from "./personal-invitation-repository";

const headers = { ...MEMBER_INVITATION_HEADERS, Vary: "Cookie" };
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }); }
function scheduleDelivery(invitationId?: string) {
  after(async () => {
    try { await processPersonalInvitationEmailBatch(invitationId ? 1 : 4, { invitationId }); }
    catch { console.error("Personal invitation email delivery could not run."); }
  });
}

export async function handlePersonalInvitationRequest(request: Request, invitationId?: string) {
  try {
    const mutation = request.method !== "GET";
    if (mutation && !isTrustedPlatformOrigin(request)) throw new MemberInvitationError(403, "Request origin is not allowed.");
    if (getPlatformConfiguration().mode !== "connected") throw new MemberInvitationError(503, "Your invitations are not connected.");
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) throw new MemberInvitationError(401, "Sign in to open your invitations.");
    const emailReady = getPersonalInvitationEmailReady();
    if (request.method === "GET" && !invitationId) {
      return json({ snapshot: { ...await getOwnPersonalInvitations(viewer.authUserId), emailReady } });
    }
    if (request.method === "POST" && !invitationId) {
      const input = validateCreatePersonalMemberInvitationInput(await readMemberInvitationJson(request));
      if (input.sendEmail && !emailReady) throw new MemberInvitationError(503, "Email sending is unavailable. You can still create an invitation and copy its link.");
      const snapshot = await createOwnPersonalInvitation(viewer.authUserId, input);
      if (input.sendEmail) scheduleDelivery();
      return json({ snapshot: { ...snapshot, emailReady } }, 201);
    }
    if (request.method === "PATCH" && invitationId) {
      const value = await readMemberInvitationJson(request);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberInvitationError(400, "Choose an invitation action.");
      const input = value as Record<string, unknown>;
      if (Object.keys(input).some(key => key !== "action" && key !== "version") || !["revoke", "retry_email"].includes(String(input.action))) {
        throw new MemberInvitationError(400, "Choose an invitation action.");
      }
      if (input.action === "retry_email" && !emailReady) throw new MemberInvitationError(503, "Email sending is temporarily unavailable.");
      const version = { version: input.version as number };
      const snapshot = input.action === "revoke"
        ? await revokeOwnPersonalInvitation(viewer.authUserId, invitationId, version)
        : await retryOwnPersonalInvitationEmail(viewer.authUserId, invitationId, version);
      if (input.action === "retry_email") scheduleDelivery(invitationId);
      return json({ snapshot: { ...snapshot, emailReady } });
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    if (error instanceof MemberInvitationError) return json({ error: error.message }, error.status);
    console.error("Personal invitation request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: "Your invitations are temporarily unavailable. Try again." }, 503);
  }
}
