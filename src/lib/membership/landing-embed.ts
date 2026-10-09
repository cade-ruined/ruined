const MEMBER_BASE = "https://members.theruinedproject.com";
const PUBLIC_ORIGINS = new Set(["https://theruinedproject.com", "https://www.theruinedproject.com"]);
const LOCAL_ORIGINS = new Set(["http://localhost:3300", "http://127.0.0.1:3300"]);

/** No member data, email code, invitation token, or arbitrary redirect crosses the frame boundary. */
export function membershipEmbedDestination(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/u.test(value)) return null;
  const rawPath = value.split(/[?#]/u, 1)[0];
  if (!/^\/(?:my|ops|access|membership)(?:\/[a-z0-9_-]+)*$/iu.test(rawPath)) return null;
  const destination = new URL(value, MEMBER_BASE);
  if (destination.origin !== MEMBER_BASE || destination.pathname !== rawPath || destination.pathname === "/membership/embed") return null;
  // Query parameters can contain account or invitation data. They are never forwarded.
  return destination.pathname + (destination.pathname === "/membership" && destination.hash === "#your-invitation" ? destination.hash : "");
}

export function membershipEmbedParentOrigin(referrer: string, development = false): string | null {
  try {
    const origin = new URL(referrer).origin;
    return PUBLIC_ORIGINS.has(origin) || (development && LOCAL_ORIGINS.has(origin)) ? origin : null;
  } catch { return null; }
}

export type MembershipEmbedMessage =
  | { type: "ruined:membership:navigate"; path: string }
  | { type: "ruined:membership:ready" }
  | { type: "ruined:membership:close" };

export function membershipEmbedNavigationMessage(destination: unknown): MembershipEmbedMessage | null {
  const path = membershipEmbedDestination(destination);
  return path ? { type: "ruined:membership:navigate", path } : null;
}
