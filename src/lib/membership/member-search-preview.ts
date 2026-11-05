import { MEMBER_SEARCH_PAGE_SIZE, normalizeMemberSearchQuery, type MemberSearchResult, type MemberSearchSnapshot } from "./member-search-model";

const NAMES = ["Alex Rivera", "Amelia Brooks", "Avery Chen", "Blair Ellis", "Cameron Lee", "Charlie Morgan", "Dakota Reed", "Drew Bennett", "Eden Parker", "Ellis James", "Emery Cole", "Finley Ross", "Harper Lane", "Jamie Wells", "Jordan Avery", "Kai Brooks", "Kendall Gray", "Lane Miller", "Logan Quinn", "Morgan Hayes", "Noah Blake", "Parker Reese", "Peyton Drew", "Preview Member", "Quinn Taylor", "Reese Martin", "Riley Jordan", "River Clarke", "Rowan Brooks", "Sage Monroe", "Sam Campbell", "Taylor Reed"];
const BIOS = ["Building things with care. Making room for what matters.", "A creative practice, one day at a time.", "Finding good questions and following them.", null];
const MEMBERS: MemberSearchResult[] = NAMES.map((name, index) => {
  const memberTag = name.toLowerCase().replaceAll(" ", "_");
  return { name, memberTag, bio: BIOS[index % BIOS.length], memberNumber: name === "Preview Member" ? 1 : index + 2,
    href: `/profile/${memberTag}`, avatarUrl: name === "Preview Member" ? "/membership/foundations/beginning.webp"
      : index % 4 === 3 ? null : `/membership/circle/portrait-${index % 9 + 1}.webp` };
});

export function getPreviewMemberProfile(memberTag: string): MemberSearchResult | null {
  return MEMBERS.find(member => member.memberTag === memberTag) ?? null;
}

/** Fictional, local-preview-only people. Never merged into connected results. */
export function getMemberSearchPreview(value = "", page = 1): MemberSearchSnapshot {
  const query = normalizeMemberSearchQuery(value);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = MEMBERS.filter(member => words.every(word => `${member.name} ${member.memberTag}`.toLowerCase().includes(word)));
  const start = (page - 1) * MEMBER_SEARCH_PAGE_SIZE;
  return { query, page, results: all.slice(start, start + MEMBER_SEARCH_PAGE_SIZE), hasMore: all.length > start + MEMBER_SEARCH_PAGE_SIZE };
}
