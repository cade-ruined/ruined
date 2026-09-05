import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

export class PasswordlessDeliveryError extends Error {
  constructor(readonly code: string | null) {
    super("The access email could not be sent.");
    this.name = "PasswordlessDeliveryError";
  }
}

/**
 * Sends the same short-lived passwordless code used by the access screen.
 * Authorization remains in the application database; this client only asks
 * Supabase Auth to create the identity and prove ownership of the email.
 */
export async function sendInvitedOperatorAccessCode(email: string): Promise<void> {
  const config = getSupabasePublicConfig();
  if (!config) throw new PasswordlessDeliveryError("not_configured");

  const supabase = createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw new PasswordlessDeliveryError(error.code ?? null);
}
