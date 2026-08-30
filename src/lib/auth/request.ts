function isLocalDevelopmentHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function isEquivalentLocalDevelopmentOrigin(left: URL, right: URL): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    left.protocol === "http:" &&
    right.protocol === "http:" &&
    isLocalDevelopmentHost(left.hostname) &&
    isLocalDevelopmentHost(right.hostname) &&
    left.port === right.port
  );
}

export function isTrustedPlatformOrigin(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin");

  if (!suppliedOrigin) {
    return request.headers.get("sec-fetch-site") === "same-origin";
  }

  try {
    const requestUrl = new URL(request.url);
    const suppliedUrl = new URL(suppliedOrigin);
    const allowed = new Set([requestUrl.origin]);
    const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configured) allowed.add(new URL(configured).origin);
    return (
      allowed.has(suppliedUrl.origin) ||
      isEquivalentLocalDevelopmentOrigin(requestUrl, suppliedUrl)
    );
  } catch {
    return false;
  }
}

function parseTrustedPlatformSiteOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const allowedProtocol =
      url.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        isLocalDevelopmentHost(url.hostname));

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
  _value: unknown,
  audience: "member" | "ops",
): "/my/join" | "/ops" {
  return audience === "ops" ? "/ops" : "/my/join";
}
