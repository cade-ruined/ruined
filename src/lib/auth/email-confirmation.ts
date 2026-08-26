export const MEMBER_EMAIL_CONFIRMATION_PATH = "/my/confirmed" as const;

export type MemberEmailConfirmationStatus = "confirmed" | "error" | "neutral";

type ConfirmationLocation = Readonly<{
  hash: string;
  search: string;
}>;

type ConfirmationHistory = Readonly<{
  state: unknown;
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
}>;

function hasValue(params: URLSearchParams, name: string): boolean {
  return Boolean(params.get(name)?.trim());
}

export function getMemberEmailConfirmationStatus(
  search: string,
  hash: string,
): MemberEmailConfirmationStatus {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const sources = [query, fragment];

  const hasError = sources.some(
    (params) =>
      hasValue(params, "error") ||
      hasValue(params, "error_code") ||
      hasValue(params, "error_description"),
  );

  if (hasError) return "error";

  const hasPkceConfirmation = hasValue(query, "code");
  const hasImplicitSignupConfirmation = sources.some(
    (params) =>
      params.get("type") === "signup" &&
      hasValue(params, "access_token"),
  );

  return hasPkceConfirmation || hasImplicitSignupConfirmation ? "confirmed" : "neutral";
}

export function consumeMemberEmailConfirmationLocation({
  history,
  location,
}: {
  history: ConfirmationHistory;
  location: ConfirmationLocation;
}): MemberEmailConfirmationStatus {
  const status = getMemberEmailConfirmationStatus(location.search, location.hash);

  if (location.search || location.hash) {
    history.replaceState(history.state, "", MEMBER_EMAIL_CONFIRMATION_PATH);
  }

  return status;
}
