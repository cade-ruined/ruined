export const MEMBERSHIP_ORIGIN = "https://members.theruinedproject.com";

export function getMembershipEmbedOrigin() {
  const preview = process.env.NEXT_PUBLIC_MEMBERSHIP_EMBED_ORIGIN;
  if (process.env.NODE_ENV === "development" &&
    (preview === "http://127.0.0.1:3301" || preview === "http://localhost:3301")) return preview;
  return MEMBERSHIP_ORIGIN;
}

/** Only trusted, known member routes may take the visitor out of the preview. */
export function membershipDestination(path: unknown, origin: string): string | null {
  if (typeof path !== "string" || path.length > 200) return null;
  const [pathname, hash] = path.split("#");
  if (!/^\/(?:my|ops|access|membership)(?:\/[a-z0-9_-]+)*$/i.test(pathname)) return null;
  if (path.includes("#") && path !== "/membership#your-invitation") return null;
  return `${origin}${pathname}${hash ? `#${hash}` : ""}`;
}

export function readMembershipMessage(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  frame: Window | null,
  origin: string,
): { type: "ready" | "close" } | { type: "navigate"; destination: string } | null {
  if (!frame || event.source !== frame || event.origin !== origin) return null;
  if (!event.data || typeof event.data !== "object") return null;
  if (event.data.type === "ruined:membership:ready") return { type: "ready" };
  if (event.data.type === "ruined:membership:close") return { type: "close" };
  if (event.data.type !== "ruined:membership:navigate") return null;
  const destination = membershipDestination(event.data.path, origin);
  return destination ? { type: "navigate", destination } : null;
}
