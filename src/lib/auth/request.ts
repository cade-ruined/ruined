export function isTrustedPlatformOrigin(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin");

  if (!suppliedOrigin) {
    return request.headers.get("sec-fetch-site") === "same-origin";
  }

  try {
    const allowed = new Set([new URL(request.url).origin]);
    const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configured) allowed.add(new URL(configured).origin);
    return allowed.has(new URL(suppliedOrigin).origin);
  } catch {
    return false;
  }
}

function parseTrustedPlatformSiteOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const localDevelopmentHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    const allowedProtocol =
      url.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        localDevelopmentHost);

    return allowedProtocol ? url.origin : null;
  } catch {
    return null;
  }
}

export function getMemberEmailConfirmationUrl(request: Request): string | null {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const trustedOrigin = configuredSiteUrl
    ? parseTrustedPlatformSiteOrigin(configuredSiteUrl)
    : process.env.NODE_ENV !== "production"
      ? parseTrustedPlatformSiteOrigin(request.url)
      : null;

  return trustedOrigin ? new URL("/my/confirmed", trustedOrigin).toString() : null;
}

export function safePlatformNextPath(
  value: unknown,
  audience: "member" | "ops",
): "/my" | "/ops" {
  if (audience === "ops") return value === "/ops" ? "/ops" : "/ops";
  return value === "/my" ? "/my" : "/my";
}
