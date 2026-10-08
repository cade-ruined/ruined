const SUPPORT_RETURN_PATTERN = /^\/(?:my|ops)\/support(?:\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})?$/;
const MEMBER_RETURN_PATHS = new Set(["/my", "/my/join", "/my/activate"]);

/** Exact account destinations only; no member identifiers, query strings or external URLs. */
export function getMemberReturnTo(value: unknown): string | null {
  return typeof value === "string" && MEMBER_RETURN_PATHS.has(value) ? value : null;
}

/** A navigation hint only. The destination still authorizes every request. */
export function getSupportReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim() || !SUPPORT_RETURN_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

export function getSupportAccessUrl(value: unknown): string {
  const returnTo = getSupportReturnTo(value);
  return returnTo ? `/access?returnTo=${encodeURIComponent(returnTo)}` : "/access";
}

/** Shared sign-in accepts a small allowlist. Each destination still enforces its own access rules. */
export function getAccessReturnTo(value: unknown): string | null {
  return getMemberReturnTo(value) ?? getSupportReturnTo(value);
}

export function getMemberAccessUrl(value: unknown): string {
  const returnTo = getMemberReturnTo(value);
  return returnTo ? `/access?returnTo=${encodeURIComponent(returnTo)}` : "/access";
}
