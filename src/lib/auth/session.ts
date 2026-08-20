import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PlatformViewer } from "@/lib/platform/model";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getCurrentPlatformViewer(): Promise<PlatformViewer | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;

    const authUserId = data.claims.sub;
    const email = data.claims.email;

    if (
      typeof authUserId !== "string" ||
      !UUID_PATTERN.test(authUserId) ||
      typeof email !== "string" ||
      !EMAIL_PATTERN.test(email)
    ) {
      return null;
    }

    return { authUserId, email: email.trim().toLowerCase() };
  } catch {
    return null;
  }
}
