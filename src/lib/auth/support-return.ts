const SUPPORT_RETURN_PATTERN = /^\/(?:my|ops)\/support(?:\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})?$/;

const FOUNDATIONS_TIMELINE_RETURN = "/my/foundations/timeline/part-1";

/** A navigation hint only. Each supported destination still authorizes every request. */
export function getSupportReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (value === FOUNDATIONS_TIMELINE_RETURN) return value;
  if (!SUPPORT_RETURN_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

export function getSupportAccessUrl(value: unknown): string {
  const returnTo = getSupportReturnTo(value);
  return returnTo ? `/access?returnTo=${encodeURIComponent(returnTo)}` : "/access";
}
