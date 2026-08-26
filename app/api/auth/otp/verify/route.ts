import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin, safePlatformNextPath } from "@/lib/auth/request";
import { getPlatformConfiguration } from "@/lib/platform/config";
import {
  PlatformAccessDeniedError,
  claimPlatformMemberForViewer,
  getOperatorRole,
  getPasswordlessAccessEligibility,
} from "@/lib/platform/repository";
import { createSupabaseCurrentResponseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const TOKEN_PATTERN = /^\d{6,10}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_DENIED_MESSAGE = "That code is invalid, expired, or not eligible.";

type VerifyBody = {
  audience?: unknown;
  email?: unknown;
  next?: unknown;
  token?: unknown;
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
  const audience = body?.audience === "ops" ? "ops" : "member";
  const redirectTo = safePlatformNextPath(body?.next, audience);

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email) || !TOKEN_PATTERN.test(token)) {
    return NextResponse.json({ error: "Enter the access code from your email." }, { status: 400 });
  }

  try {
    const eligibility = await getPasswordlessAccessEligibility(email, audience);
    if (eligibility === "none") {
      return NextResponse.json({ error: ACCESS_DENIED_MESSAGE }, { status: 401 });
    }
  } catch (error) {
    console.error("Passwordless access eligibility could not be checked", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: ACCESS_DENIED_MESSAGE }, { status: 503 });
  }

  const response = NextResponse.json({ redirectTo });
  const supabase = createSupabaseCurrentResponseClient({ request, response });
  if (!supabase) {
    return NextResponse.json({ error: "Passwordless access is not configured yet." }, { status: 503 });
  }

  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) {
    return NextResponse.json({ error: ACCESS_DENIED_MESSAGE }, { status: 401 });
  }

  const authUserId = data.user.id;
  const verifiedEmail = data.user.email?.trim().toLowerCase();
  if (!UUID_PATTERN.test(authUserId) || verifiedEmail !== email) {
    return denyVerifiedSession(request, 401);
  }

  try {
    if (audience === "member") {
      await claimPlatformMemberForViewer({ authUserId, email: verifiedEmail });
    } else if (!(await getOperatorRole(authUserId))) {
      throw new PlatformAccessDeniedError();
    }
  } catch (authorizationError) {
    const denied = authorizationError instanceof PlatformAccessDeniedError;
    if (!denied) {
      console.error("Verified passwordless access could not be authorized", {
        audience,
        errorType: authorizationError instanceof Error ? authorizationError.name : "UnknownError",
      });
    }
    return denyVerifiedSession(request, denied ? 401 : 503);
  }

  return response;
}
