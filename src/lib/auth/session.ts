import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PlatformViewer } from "@/lib/platform/model";
import { isInvalidPlatformSessionError } from "@/lib/auth/session-errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export type PlatformSession =
  | { status: "authenticated"; viewer: PlatformViewer }
  | { status: "signed_out" }
  | { status: "unavailable" };

function sessionFailure(error: unknown): PlatformSession {
  return { status: isInvalidPlatformSessionError(error) ? "signed_out" : "unavailable" };
}

function viewerFromClaims(authUserId: unknown, email: unknown): PlatformViewer | null {
  if (typeof authUserId !== "string" || !UUID_PATTERN.test(authUserId)
    || typeof email !== "string" || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return { authUserId, email: email.trim().toLowerCase() };
}

/** Validates credentials; membership and operator permissions remain server-side route checks. */
export async function resolvePlatformSession(
  supabase: SupabaseClient | null,
  { verifyCurrentUser = false }: { verifyCurrentUser?: boolean } = {},
): Promise<PlatformSession> {
  if (!supabase) return { status: "unavailable" };
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) return sessionFailure(error);
    if (!data?.claims) return { status: "signed_out" };
    const viewer = viewerFromClaims(data.claims.sub, data.claims.email);
    if (!viewer) return { status: "signed_out" };
    if (verifyCurrentUser) {
      // The foreground check also asks Auth for the current user. A previously
      // valid JWT alone must not report a deleted/banned identity as signed in.
      const { data: current, error: currentError } = await supabase.auth.getUser();
      if (currentError) return sessionFailure(currentError);
      const verified = viewerFromClaims(current?.user?.id, current?.user?.email);
      if (!verified || verified.authUserId !== viewer.authUserId || verified.email !== viewer.email) {
        return { status: "signed_out" };
      }
    }
    return { status: "authenticated", viewer };
  } catch (error) {
    return sessionFailure(error);
  }
}

export async function resolveCurrentPlatformSession(): Promise<PlatformSession> {
  try {
    return await resolvePlatformSession(await createSupabaseServerClient());
  } catch (error) {
    return sessionFailure(error);
  }
}

/** Existing API guards remain fail-closed; page callers can distinguish unavailable above. */
export async function getCurrentPlatformViewer(): Promise<PlatformViewer | null> {
  const session = await resolveCurrentPlatformSession();
  return session.status === "authenticated" ? session.viewer : null;
}
