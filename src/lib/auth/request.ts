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
export function safePlatformNextPath(
  value: unknown,
  audience: "member" | "ops",
): "/my" | "/ops" {
  if (audience === "ops") return value === "/ops" ? "/ops" : "/ops";
  return value === "/my" ? "/my" : "/my";
}
