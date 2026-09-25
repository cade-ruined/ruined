import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getMemberEmailConfirmationUrl,
  isTrustedPlatformOrigin,
  MEMBER_INVITATION_CONTEXT_COOKIE,
  MEMBER_SIGNUP_CONTEXT_COOKIE,
} from "@/lib/auth/request";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getUnifiedAccessEligibility } from "@/lib/auth/platform-access";
import { getPersonalInvitationAdmissionEligibility } from "@/lib/membership/personal-invitation-admission";
import { createSupabaseCurrentResponseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

type RequestBody = {
  email?: unknown;
  invitationToken?: unknown;
  signup?: unknown;
};

export async function POST(request: NextRequest) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "Passwordless access is not configured yet." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const invitationToken = body?.invitationToken;
  const signup = body?.signup;

  if (signup !== undefined) {
    return NextResponse.json({ error: "Open your Ruined invitation to continue signup." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }

  if (invitationToken !== undefined && (typeof invitationToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(invitationToken))) {
    return NextResponse.json({ error: "This invitation is unavailable or doesn’t match that email." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const requestId = crypto.randomUUID();
  const response = NextResponse.json({ ok: true, requestId });
  response.headers.set("Cache-Control", "private, no-store");
  const supabase = createSupabaseCurrentResponseClient({ request, response });

  if (!supabase) {
    return NextResponse.json({ error: "Passwordless access is not configured yet." }, { status: 503 });
  }

  let eligibility: Awaited<ReturnType<typeof getUnifiedAccessEligibility>>;

  try {
    if (invitationToken && !await getPersonalInvitationAdmissionEligibility(email, invitationToken)) {
      return NextResponse.json({ error: "This invitation is unavailable or doesn’t match that email." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    }
    eligibility = await getUnifiedAccessEligibility(email);
    if (invitationToken) {
      // This read only permits delivery of a verification code. Admission is
      // claimed atomically after Supabase verifies the invited email.
      eligibility = { ...eligibility, eligible: true,
        shouldCreateUser: eligibility.member !== "returning" && eligibility.operator !== "returning" };
    }
  } catch (error) {
    console.error("Passwordless access eligibility could not be checked", {
      requestId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return invitationToken
      ? NextResponse.json({ error: "Your invitation could not be checked. Please try again." }, { status: 503, headers: { "Cache-Control": "private, no-store" } })
      : response;
  }

  if (!eligibility.eligible) {
    console.info("Passwordless access request needs an active account or invitation", { requestId });
    return response;
  }

  let options: { emailRedirectTo?: string; shouldCreateUser: boolean } = {
    shouldCreateUser: false,
  };

  if (eligibility.shouldCreateUser) {
    const emailRedirectTo = getMemberEmailConfirmationUrl(request);
    if (!emailRedirectTo) {
      console.error("Email confirmation destination is not safely configured", { requestId });
      return response;
    }
    // Only eligible invitations can create an authentication identity.
    // Membership entry is linked only after verification; payment grants paid access.
    options = { emailRedirectTo, shouldCreateUser: true };
  }

  if (invitationToken) {
    // Navigation context for providers that send an email-confirmation link.
    // This grants no access; verified admission still requires the exact token.
    response.cookies.set(MEMBER_INVITATION_CONTEXT_COOKIE, invitationToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      path: "/my/confirmed", maxAge: 3600,
    });
  }
  response.cookies.set(MEMBER_SIGNUP_CONTEXT_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/my/confirmed", maxAge: 0,
  });

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options,
    });

    if (error) {
      console.warn("Supabase passwordless code request was not delivered", {
        requestId,
        errorCode: error.code,
        status: error.status,
      });
    } else {
      // Provider acceptance is not proof of inbox delivery. Do not log codes or email addresses.
      console.info("Passwordless code request accepted by email provider", { requestId });
    }
  } catch (error) {
    console.warn("Supabase passwordless code request was not delivered", {
      requestId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }

  // Keep the response generic so an operator address or existing member
  // cannot be discovered by probing this endpoint.
  return response;
}
