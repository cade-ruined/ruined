export const MEMBER_SEARCH_LIMIT = 80;
export const MEMBER_SEARCH_PAGE_SIZE = 24;
export const MEMBER_SEARCH_MAX_PAGE = 1_000;

export type MemberSearchResult = {
  name: string;
  memberTag: string | null;
  bio: string | null;
  memberNumber: number | null;
  href: string;
};
export type MemberSearchSnapshot = {
  query: string;
  page: number;
  results: MemberSearchResult[];
  hasMore: boolean;
};
export class MemberSearchError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MemberSearchError";
  }
}
export function normalizeMemberSearchQuery(value: string): string {
  const query = value.trim().replace(/^(?:@\s*)+/, "").replace(/\s+/g, " ");
  if (query.length > MEMBER_SEARCH_LIMIT || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new MemberSearchError(400, "Search using a name or @tag of up to 80 characters.");
  }
  return query;
}
export function parseMemberSearchPage(value: string | null | undefined): number {
  if (value == null || value === "") return 1;
  if (!/^[1-9]\d{0,3}$/.test(value) || Number(value) > MEMBER_SEARCH_MAX_PAGE) {
    throw new MemberSearchError(400, "Choose a valid member results page.");
  }
  return Number(value);
}
