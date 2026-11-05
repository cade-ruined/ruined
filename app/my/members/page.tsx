import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MemberDirectory from "@/components/membership/MemberDirectory";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { MEMBER_SEARCH_LIMIT, MemberSearchError, normalizeMemberSearchQuery } from "@/lib/membership/member-search-model";
import { getMemberSearch } from "@/lib/membership/member-search-repository";
import { getMemberSearchPreview } from "@/lib/membership/member-search-preview";
import { withFreshApplicationDatabaseRead } from "@/lib/database/server";

export const metadata: Metadata = { title: "Members | Ruined", description: "Browse Ruined members and find their public profiles." };
export const dynamic = "force-dynamic";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q ?? "";
  const query = normalizeMemberSearchQuery(rawQuery.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MEMBER_SEARCH_LIMIT));
  const context = await getMembershipPageContext(getMemberSearchPreview(query),
    async authUserId => {
      try { return await withFreshApplicationDatabaseRead("member-search", () => getMemberSearch(authUserId, query)); }
      catch (error) { if (error instanceof MemberSearchError && error.status === 403) return null; throw error; }
    }, "members");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberDirectory key={context.data.query} initialSearch={context.data} preview={context.state === "preview"} />;
}
