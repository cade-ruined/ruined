import type { NextRequest } from "next/server";

import { refreshSupabaseMiddlewareSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response } = await refreshSupabaseMiddlewareSession(request);
  return response;
}

export const config = {
  matcher: [
    "/my/:path*",
    "/ops/:path*",
    "/api/auth/:path*",
    "/api/stripe/checkout/:path*",
    "/api/stripe/portal/:path*",
  ],
};
