import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { completePlatformSignIn, getSupportSignInDestination, getUnifiedAccessEligibility } from "@/lib/auth/platform-access";
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
};

async function denyVerifiedSession(request: NextRequest, status: 401 | 503) {
  const denialResponse = NextResponse.json({ error: ACCESS_DENIED_MESSAGE }, { status });
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

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email) || !TOKEN_PATTERN.test(token)) {
    return denyVerifiedSession(request, 401);
  }

  try {
    const eligibility = await getUnifiedAccessEligibility(email);
    if (!eligibility.eligible) {
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
    const { redirectTo } = await completePlatformSignIn({ authUserId, email: verifiedEmail });
    const destination = body?.returnTo === undefined ? redirectTo : await getSupportSignInDestination(
      { authUserId, email: verifiedEmail }, body.returnTo, redirectTo,
    );
    const authorizedResponse = NextResponse.json({ redirectTo: destination });
    // Preserve SSR's cookie attributes and cache-prevention headers when adding
    // the server-selected destination to the final response.
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie" && name !== "content-type") authorizedResponse.headers.set(name, value);
    });
    response.cookies.getAll().forEach((cookie) => authorizedResponse.cookies.set(cookie));
    authorizedResponse.headers.set("Cache-Control", "private, no-store");
    return authorizedResponse;
  } catch (authorizationError) {
    const denied = authorizationError instanceof PlatformAccessDeniedError;
    if (!denied) {
      console.error("Verified passwordless access could not be authorized", {
        errorType: authorizationError instanceof Error ? authorizationError.name : "UnknownError",
      });
    }
    return denyVerifiedSession(request, denied ? 401 : 503);
  }
}
