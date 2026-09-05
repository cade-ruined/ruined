import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getMemberEmailConfirmationUrl,
  isTrustedPlatformOrigin,
} from "@/lib/auth/request";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getUnifiedAccessEligibility } from "@/lib/auth/platform-access";
import { createSupabaseCurrentResponseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

type RequestBody = {
  email?: unknown;
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

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseCurrentResponseClient({ request, response });

  if (!supabase) {
    return NextResponse.json({ error: "Passwordless access is not configured yet." }, { status: 503 });
  }

  let eligibility: Awaited<ReturnType<typeof getUnifiedAccessEligibility>>;

  try {
    eligibility = await getUnifiedAccessEligibility(email);
  } catch (error) {
    console.error("Passwordless access eligibility could not be checked", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return response;
  }

  if (!eligibility.eligible) return response;

  let options: { emailRedirectTo?: string; shouldCreateUser: boolean } = {
    shouldCreateUser: false,
  };

  if (eligibility.shouldCreateUser) {
    const emailRedirectTo = getMemberEmailConfirmationUrl(request);
    if (!emailRedirectTo) {
      console.error("Email confirmation destination is not safely configured");
      return response;
    }
    // Either kind of durable invitation can create an authentication identity.
    // The role is granted only after verification claims that invitation.
    options = { emailRedirectTo, shouldCreateUser: true };
  }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options,
    });

    if (error) {
      console.warn("Supabase passwordless code request was not delivered", {
        errorCode: error.code,
        status: error.status,
      });
    }
  } catch (error) {
    console.warn("Supabase passwordless code request was not delivered", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }

  // Keep the response generic so an operator address or existing member
  // cannot be discovered by probing this endpoint.
  return response;
}
