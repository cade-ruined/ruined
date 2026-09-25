import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { isMembershipBillingPlan } from "@/lib/membership/pricing";
import { MemberInvitationError, readMemberInvitationJson } from "@/lib/membership/invitation-model";
import { validateCreatePersonalMemberInvitationInput } from "@/lib/membership/personal-invitation-model";
import { issueRuinedDirectInvitation } from "@/lib/membership/direct-invitation-repository";
import { consumePublicMembershipSignupRateLimit, getPublicMembershipSignupEligibility } from "@/lib/membership/public-signup-admission";
import { getPersonalInvitationEmailReady, processPersonalInvitationEmailBatch } from "@/lib/membership/personal-invitation-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

/** Public signup issues a card first. It cannot create a member, session, or free benefit. */
export async function POST(request: NextRequest) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  }
  const configuration = getPlatformConfiguration();
  if (configuration.mode !== "connected" || !configuration.stripeCheckoutReady || !getPersonalInvitationEmailReady()) {
    return NextResponse.json({ error: "Membership invitations are not available yet. Join the waitlist to hear when we open." }, { status: 503, headers });
  }
  try {
    const body = await readMemberInvitationJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["requestId", "recipientName", "recipientEmail", "billingPlan"].includes(key))) {
      throw new MemberInvitationError(400, "Enter your name and email and choose a membership plan.");
    }
    const value = body as Record<string, unknown>;
    if (!isMembershipBillingPlan(value.billingPlan)) throw new MemberInvitationError(400, "Choose a membership plan.");
    const input = validateCreatePersonalMemberInvitationInput({ requestId: value.requestId,
      recipientName: value.recipientName, recipientEmail: value.recipientEmail, sendEmail: true });
    const response = NextResponse.json({ ok: true, requestId: input.requestId }, { headers });
    // Same response for new, returning, blocked and rate-limited addresses. A
    // bearer token is delivered only to the requested mailbox, never to a caller.
    if (!await consumePublicMembershipSignupRateLimit(input.recipientEmail, request)
      || !await getPublicMembershipSignupEligibility(input.recipientEmail)) return response;
    const issued = await issueRuinedDirectInvitation({ requestId: input.requestId, recipientName: input.recipientName,
      recipientEmail: input.recipientEmail, billingPlan: value.billingPlan });
    if (issued) await processPersonalInvitationEmailBatch(1, { invitationId: issued.invitationId });
    return response;
  } catch (error) {
    if (error instanceof MemberInvitationError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    // Recipient details, tokens and provider responses never enter logs.
    console.error("Ruined Direct invitation request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "We couldn’t prepare your invitation. Please try again." }, { status: 503, headers });
  }
}
