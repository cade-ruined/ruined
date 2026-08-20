import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin, safePlatformNextPath } from "@/lib/auth/request";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { createSupabaseCurrentResponseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_PATTERN = /^\d{6,10}$/;

type VerifyBody = {
  audience?: unknown;
  email?: unknown;
  next?: unknown;
  token?: unknown;
};

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

  if (!EMAIL_PATTERN.test(email) || !TOKEN_PATTERN.test(token)) {
    return NextResponse.json({ error: "Enter the access code from your email." }, { status: 400 });
  }

  const response = NextResponse.json({ redirectTo });
  const supabase = createSupabaseCurrentResponseClient({ request, response });
  if (!supabase) {
    return NextResponse.json({ error: "Passwordless access is not configured yet." }, { status: 503 });
  }

  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) {
    return NextResponse.json({ error: "That code is invalid or has expired." }, { status: 401 });
  }

  return response;
}
