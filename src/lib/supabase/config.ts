import type { CookieOptionsWithName } from "@supabase/ssr";

export const SUPABASE_PUBLIC_ENVIRONMENT_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

export type SupabasePublicEnvironmentKey =
  (typeof SUPABASE_PUBLIC_ENVIRONMENT_KEYS)[number];

export type SupabasePublicConfig = Readonly<{
  publishableKey: string;
  url: string;
}>;

export type SupabaseConfigStatus = Readonly<{
  configured: boolean;
  invalid: readonly SupabasePublicEnvironmentKey[];
  missing: readonly SupabasePublicEnvironmentKey[];
}>;

export const SUPABASE_COOKIE_OPTIONS = {
  httpOnly: false,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} satisfies CookieOptionsWithName;

function environmentValue(name: SupabasePublicEnvironmentKey): string | null {
  // Keep references static so Next can include public values in the Edge
  // middleware bundle. Dynamic process.env lookups are not inlined.
  const value =
    name === "NEXT_PUBLIC_SUPABASE_URL"
      ? process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
      : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  return value ? value : null;
}

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const missing = SUPABASE_PUBLIC_ENVIRONMENT_KEYS.filter(
    (name) => environmentValue(name) === null,
  );
  const configuredUrl = environmentValue("NEXT_PUBLIC_SUPABASE_URL");
  const invalid =
    configuredUrl && !isValidSupabaseUrl(configuredUrl)
      ? (["NEXT_PUBLIC_SUPABASE_URL"] as const)
      : [];

  return {
    configured: missing.length === 0 && invalid.length === 0,
    invalid,
    missing,
  };
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = environmentValue("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = environmentValue(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

  if (!url || !publishableKey || !isValidSupabaseUrl(url)) return null;

  return { publishableKey, url };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfigStatus().configured;
}
