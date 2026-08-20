import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  SUPABASE_COOKIE_OPTIONS,
  getSupabasePublicConfig,
} from "@/lib/supabase/config";

export type SupabaseCurrentResponse = Readonly<{
  request: NextRequest;
  response: NextResponse;
}>;

/**
 * Creates a request-scoped client for Server Components and read-only guards.
 * Auth routes that can change a session should use
 * createSupabaseCurrentResponseClient so cookie cache headers reach the response.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, options, value }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The root middleware refreshes
          // the session before rendering; mutation routes use the response helper.
        }
      },
    },
  });
}

/**
 * Creates a request-scoped client that writes refreshed auth cookies and the
 * accompanying no-cache headers to the exact response returned by a route.
 */
export function createSupabaseCurrentResponseClient({
  request,
  response,
}: SupabaseCurrentResponse): SupabaseClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, options, value }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });
}
