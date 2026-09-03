import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { createSupabaseCurrentResponseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  const next = "/access";
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  if (getPlatformConfiguration().mode !== "connected") return response;

  const supabase = createSupabaseCurrentResponseClient({ request, response });
  if (supabase) await supabase.auth.signOut();
  return response;
}
