/**
 * Check the browser Origin against the authority that received the request.
 * Next may reconstruct request.url with an internal hostname behind a proxy;
 * Host retains the public authority. Forwarded hosts are deliberately ignored.
 */
export function isSameOriginRequest(request: Request): boolean {
  const value = request.headers.get("origin");
  if (!value) return false;
  try {
    const origin = new URL(value);
    // Browser Origin is a serialized origin, never a URL with credentials,
    // a path, query or fragment. Exact serialization rejects ambiguous forms.
    if (value !== origin.origin || origin.username || origin.password) return false;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback)) return false;

    const host = request.headers.get("host");
    if (host !== null) {
      // Parse Host only as an authority. Never fall back when a supplied Host
      // is malformed, and never allow a sibling host or a different port.
      if (!host || /[\s\\/@?#]/.test(host)) return false;
      const target = new URL(`${origin.protocol}//${host}`);
      if (target.username || target.password || target.host !== host.toLowerCase()) return false;
      return target.origin === origin.origin;
    }
    // Native Request objects in tests and trusted internal callers may omit
    // Host. In that case the request URL is the only available authority.
    return new URL(request.url).origin === origin.origin;
  } catch {
    return false;
  }
}
