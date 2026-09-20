import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin, MEMBER_INVITATION_CONTEXT_COOKIE } from "@/lib/auth/request";
import { completePlatformSignIn, getSupportSignInDestination, getUnifiedAccessEligibility } from "@/lib/auth/platform-access";
import { getPersonalInvitationAdmissionEligibility } from "@/lib/membership/personal-invitation-admission";
import { getPlatformConfiguration } from "@/lib/platform/config";
import {
  PlatformAccessDeniedError,
} from "@/lib/platform/repository";
import { createSupabaseCurrentResponseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const TOKEN_PATTERN = /^\d{6,10}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_DENIED_MESSAGE = "That code is invalid, expired, or not eligible.";

type VerifyBody = {
  email?: unknown;
  token?: unknown;
  returnTo?: unknown;
  invitationToken?: unknown;
};

async function denyVerifiedSession(request: NextRequest, status: 401 | 409 | 503, message = ACCESS_DENIED_MESSAGE) {
  const denialResponse = NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  const denialClient = createSupabaseCurrentResponseClient({
    request,
    response: denialResponse,
  });

  if (denialClient) {
    try {
      const { error } = await denialClient.auth.signOut({ scope: "local" });
      if (error) {
        console.warn("Supabase session could not be cleared after access denial", {
          errorCode: error.code,
          status: error.status,
        });
      }
    } catch (error) {
      console.warn("Supabase session could not be cleared after access denial", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return denialResponse;
}

export async function POST(request: NextRequest) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "Passwordless access is not configured yet." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as VerifyBody | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const invitationToken = body?.invitationToken;

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email) || !TOKEN_PATTERN.test(token)
    || (invitationToken !== undefined && (typeof invitationToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(invitationToken)))) {
    return denyVerifiedSession(request, 401);
  }

  try {
    const eligible = invitationToken
      ? await getPersonalInvitationAdmissionEligibility(email, invitationToken)
      : (await getUnifiedAccessEligibility(email)).eligible;
    if (!eligible) {
      return denyVerifiedSession(request, 401);
    }
  } catch (error) {
    console.error("Passwordless access eligibility could not be checked", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return denyVerifiedSession(request, 503);
  }

  // Hold cookie changes until authorization succeeds. Never return a new
  // session if the invitation was revoked while the email was in transit.
  const response = NextResponse.json({});
  const supabase = createSupabaseCurrentResponseClient({ request, response });
  if (!supabase) {
    return NextResponse.json({ error: "Passwordless access is not configured yet." }, { status: 503 });
  }

  let verified;
  try {
    verified = await supabase.auth.verifyOtp({ email, token, type: "email" });
  } catch {
    return denyVerifiedSession(request, 503);
  }
  const { data, error } = verified;
  if (error || !data.user) {
    return denyVerifiedSession(request, 401);
  }

  const authUserId = data.user.id;
  const verifiedEmail = data.user.email?.trim().toLowerCase();
  if (!UUID_PATTERN.test(authUserId) || verifiedEmail !== email) {
    return denyVerifiedSession(request, 401);
  }

  try {
    const { redirectTo } = invitationToken
      ? await completePlatformSignIn({ authUserId, email: verifiedEmail }, { invitationToken })
      : await completePlatformSignIn({ authUserId, email: verifiedEmail });
    const destination = invitationToken || body?.returnTo === undefined ? redirectTo : await getSupportSignInDestination(
      { authUserId, email: verifiedEmail }, body.returnTo, redirectTo,
    );
    const authorizedResponse = NextResponse.json({ redirectTo: destination });
    // Preserve SSR's cookie attributes and cache-prevention headers when adding
    // the server-selected destination to the final response.
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie" && name !== "content-type") authorizedResponse.headers.set(name, value);
    });
    response.cookies.getAll().forEach((cookie) => authorizedResponse.cookies.set(cookie));
    if (invitationToken) authorizedResponse.cookies.set(MEMBER_INVITATION_CONTEXT_COOKIE, "", {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      path: "/my/confirmed", maxAge: 0,
    });
    authorizedResponse.headers.set("Cache-Control", "private, no-store");
    return authorizedResponse;
  } catch (authorizationError) {
    if (authorizationError && typeof authorizationError === "object" && "code" in authorizationError && authorizationError.code === "P4102") {
      return denyVerifiedSession(request, 409, "You already have membership billing. Contact Ruined to resolve your existing subscription before switching to complimentary membership.");
    }
    const denied = authorizationError instanceof PlatformAccessDeniedError;
    if (!denied) {
      console.error("Verified passwordless access could not be authorized", {
        errorType: authorizationError instanceof Error ? authorizationError.name : "UnknownError",
      });
    }
    return denyVerifiedSession(request, denied ? 401 : 503);
  }
}
