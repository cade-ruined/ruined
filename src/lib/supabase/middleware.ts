import { createServerClient } from "@supabase/ssr";
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

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  try {
    const { data } = await supabase.auth.getClaims();
    return {
      claims: data?.claims ?? null,
      configured: true,
      response,
    };
  } catch {
    // A transient Auth failure must not turn middleware into a site-wide 500.
    // Protected layouts and handlers still fail closed when claims are absent.
    return { claims: null, configured: true, response };
  }
}
