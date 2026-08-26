import { NextResponse, type NextRequest } from "next/server";

import { isMyRuinedVisible } from "@/lib/platform/visibility";
import { refreshSupabaseMiddlewareSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/my") && !isMyRuinedVisible()) {
    return NextResponse.next();
  }

  const { response } = await refreshSupabaseMiddlewareSession(request);
  return response;
}

export const config = {
  matcher: [
    "/my/:path*",
    "/ops/:path*",
    "/api/auth/:path*",
    "/api/my/:path*",
    "/api/ops/:path*",
    "/api/stripe/checkout/:path*",
    "/api/stripe/portal/:path*",
  ],
};
