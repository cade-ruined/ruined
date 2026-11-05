import "server-only";
import { getMemberIdentity } from "./repository";
import { canPublishMemberProfile, getOwnMemberProfilePublicScope, getPublicMemberProfileSearch } from "./public-card-repository";
import { MEMBER_SEARCH_MAX_PAGE, MEMBER_SEARCH_PAGE_SIZE, MemberSearchError, normalizeMemberSearchQuery, parseMemberSearchPage, type MemberSearchSnapshot } from "./member-search-model";

async function requireSearchingMember(authUserId: string) {
  const identity = await getMemberIdentity(authUserId);
  if (!identity || !canPublishMemberProfile(identity) || !await getOwnMemberProfilePublicScope(identity.memberId)) {
    throw new MemberSearchError(403, "Active member access is required to browse members.");
  }
  return identity.memberId;
}

/** Member-only discovery of the existing public projection; never mutates registration or profiles. */
export async function getMemberSearch(authUserId: string, value: string, page = 1): Promise<MemberSearchSnapshot> {
  const query = normalizeMemberSearchQuery(value);
  const selectedPage = parseMemberSearchPage(String(page));
  const memberId = await requireSearchingMember(authUserId);
  const result = await getPublicMemberProfileSearch(query, selectedPage, MEMBER_SEARCH_PAGE_SIZE);
  if (await requireSearchingMember(authUserId) !== memberId) {
    throw new MemberSearchError(403, "Active member access is required to browse members.");
  }
  return { ...result, hasMore: selectedPage < MEMBER_SEARCH_MAX_PAGE && result.hasMore };
}
