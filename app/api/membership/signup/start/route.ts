import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { DIRECT_SIGNUP_CONTEXT_COOKIE, getMemberEmailConfirmationUrl, isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getUnifiedAccessEligibility } from "@/lib/auth/platform-access";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { isMembershipBillingPlan } from "@/lib/membership/pricing";
import { MemberInvitationError, readMemberInvitationJson } from "@/lib/membership/invitation-model";
import { validateCreatePersonalMemberInvitationInput } from "@/lib/membership/personal-invitation-model";
import { issueRuinedDirectInvitation, resolveRuinedDirectInvitationToken } from "@/lib/membership/direct-invitation-repository";
import { getPersonalInvitationAdmissionEligibility } from "@/lib/membership/personal-invitation-admission";
import { consumePublicMembershipSignupRateLimit, getPublicMembershipSignupEligibility } from "@/lib/membership/public-signup-admission";
import { createSupabaseCurrentResponseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 3600 };

/** Creates only invitation context and requests proof of email ownership. The
 * invitation is accepted and the member is linked only after OTP verification.
 */
export async function POST(request: NextRequest) {
  if (!isTrustedPlatformOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  const configuration = getPlatformConfiguration();
  if (configuration.mode !== "connected" || !configuration.membershipSignupReady) {
    return NextResponse.json({ error: "Membership registration is not available yet. Join the waitlist to hear when we open." }, { status: 503, headers });
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
      recipientName: value.recipientName, recipientEmail: value.recipientEmail, sendEmail: false });
    const response = NextResponse.json({ ok: true, requestId: input.requestId }, { headers });
    // Always set the same-shaped opaque context, including unknown, returning,
    // blocked and throttled requests. Preserve a prior code's context on resend.
    const priorContext = request.cookies.get(DIRECT_SIGNUP_CONTEXT_COOKIE)?.value;
    response.cookies.set(DIRECT_SIGNUP_CONTEXT_COOKIE,
      priorContext && /^[A-Za-z0-9_-]{43}$/.test(priorContext) ? priorContext : randomBytes(32).toString("base64url"), cookieOptions);
    const supabase = createSupabaseCurrentResponseClient({ request, response });
    if (!supabase) return NextResponse.json({ error: "Email verification is not configured yet." }, { status: 503, headers });
    if (!await consumePublicMembershipSignupRateLimit(input.recipientEmail, request)
      || !await getPublicMembershipSignupEligibility(input.recipientEmail)) return response;

    const access = await getUnifiedAccessEligibility(input.recipientEmail);
    const returning = access.member === "returning" || access.operator === "returning";
    if (!returning) {
      const issued = await issueRuinedDirectInvitation({ requestId: input.requestId, recipientName: input.recipientName,
        recipientEmail: input.recipientEmail, billingPlan: value.billingPlan }, { emailDelivery: false });
      if (!issued) return response;
      const invitationToken = await resolveRuinedDirectInvitationToken(input.recipientEmail, { invitationId: issued.invitationId });
      if (!invitationToken || !await getPersonalInvitationAdmissionEligibility(input.recipientEmail, invitationToken)) return response;
      response.cookies.set(DIRECT_SIGNUP_CONTEXT_COOKIE, invitationToken, cookieOptions);
    }
    const emailRedirectTo = getMemberEmailConfirmationUrl(request);
    if (!returning && !emailRedirectTo) return response;
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: input.recipientEmail,
        options: returning ? { shouldCreateUser: false } : { shouldCreateUser: true, emailRedirectTo: emailRedirectTo! } });
      if (error) console.warn("Direct signup code request was not delivered", { requestId: input.requestId, errorCode: error.code, status: error.status });
    } catch (error) {
      console.warn("Direct signup code request was not delivered", { requestId: input.requestId, errorType: error instanceof Error ? error.name : "UnknownError" });
    }
    return response;
  } catch (error) {
    if (error instanceof MemberInvitationError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    console.error("Ruined Direct signup request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "We couldn’t prepare your registration. Please try again." }, { status: 503, headers });
  }
}
