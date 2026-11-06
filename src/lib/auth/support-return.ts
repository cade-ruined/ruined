const SUPPORT_RETURN_PATTERN = /^\/(?:my|ops)\/support(?:\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})?$/;
const MEMBER_RETURN_PATHS = new Set(["/my", "/my/join", "/my/activate"]);

/** Exact account destinations only; no member identifiers, query strings or external URLs. */
export function getMemberReturnTo(value: unknown): string | null {
  return typeof value === "string" && MEMBER_RETURN_PATHS.has(value) ? value : null;
}

const TIMELINE_RETURN_PATHS = new Set(["/my/foundations/timeline/part-1", "/my/timeline", "/my/timeline/new"]);

function timelineReturnWithContext(value: string): string | null {
  const parts = value.split("?");
  if (parts.length !== 2 || !["/my/timeline", "/my/timeline/new"].includes(parts[0]) || !parts[1] || value.includes("#") || value.length > 240) return null;
  const params = new URLSearchParams(parts[1]);
  const names = [...params.keys()];
  if (new Set(names).size !== names.length || names.some(name => !["moment", "practice", "resume"].includes(name))) return null;
  if (params.has("practice") && params.get("practice") !== "f1") return null;
  if (params.has("resume") && (params.get("resume") !== "1" || params.get("practice") !== "f1")) return null;
  if (params.has("moment") && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.get("moment")!)) return null;
  return names.length ? value : null;
}

/** A navigation hint only. Each supported destination still authorizes every request. */
export function getSupportReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (TIMELINE_RETURN_PATHS.has(value)) return value;
  const timeline = timelineReturnWithContext(value);
  if (timeline) return timeline;
  if (!SUPPORT_RETURN_PATTERN.test(value)) return null;
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
