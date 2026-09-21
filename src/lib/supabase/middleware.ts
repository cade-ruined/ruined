import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isInvalidPlatformSessionError } from "@/lib/auth/session-errors";
import type { JwtPayload } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import {
  SUPABASE_COOKIE_OPTIONS,
  getSupabasePublicConfig,
} from "@/lib/supabase/config";
import { getPlatformConfiguration } from "@/lib/platform/config";

export type SupabaseMiddlewareSession = Readonly<{
  claims: JwtPayload | null;
  configured: boolean;
  response: NextResponse;
}>;

/**
 * Refreshes Supabase's cookie session for downstream Server Components and
 * handlers. Authorization remains the responsibility of route-level guards.
 */
export async function refreshSupabaseMiddlewareSession(
  request: NextRequest,
): Promise<SupabaseMiddlewareSession> {
  let response = NextResponse.next({ request });

  if (getPlatformConfiguration().mode !== "connected") {
    return { claims: null, configured: false, response };
  }

  const config = getSupabasePublicConfig();

  if (!config) {
    return { claims: null, configured: false, response };
  }

  // The SDK may clear cookies for an unrecognized provider failure. Buffer its
  // changes so an outage cannot erase a recoverable browser session.
  const jar = new Map(request.cookies.getAll().map(cookie => [cookie.name, cookie]));
  const pendingCookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
  let pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() { return [...jar.values()]; },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(cookie => {
          jar.set(cookie.name, { name: cookie.name, value: cookie.value });
          pendingCookies.set(cookie.name, cookie);
        });
        pendingHeaders = { ...pendingHeaders, ...headers };
      },
    },
  });

  let claims: JwtPayload | null = null;
  let unavailable = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) unavailable = !isInvalidPlatformSessionError(error);
    else claims = data?.claims ?? null;
  } catch (error) {
    unavailable = !isInvalidPlatformSessionError(error);
  }
  const changes = [...pendingCookies.values()];
  // Preserve a successful token rotation even if later claim verification is
  // temporarily unavailable; suppress only destructive cookie-only cleanup.
  if (!unavailable || changes.some(cookie => cookie.value !== "")) {
    changes.forEach(({ name, value }) => request.cookies.set(name, value));
    response = NextResponse.next({ request });
    changes.forEach(({ name, options, value }) => response.cookies.set(name, value, options));
  }
  Object.entries(pendingHeaders).forEach(([name, value]) => response.headers.set(name, value));
  return { claims, configured: true, response };
}
