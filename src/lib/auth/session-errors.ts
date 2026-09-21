const INVALID_SESSION_CODES = new Set([
  "bad_jwt", "invalid_jwt", "no_authorization", "session_not_found", "session_expired",
  "refresh_token_not_found", "refresh_token_already_used", "user_not_found", "user_banned",
]);

/** Safe in middleware: transport/provider outages are not proof of a lost login. */
export function isInvalidPlatformSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { name?: unknown; code?: unknown; status?: unknown };
  if (detail.name === "AuthRetryableFetchError" || detail.status === 429
    || (typeof detail.status === "number" && detail.status >= 500)) return false;
  return detail.name === "AuthSessionMissingError" || detail.name === "AuthInvalidJwtError"
    || (typeof detail.code === "string" && INVALID_SESSION_CODES.has(detail.code));
}
