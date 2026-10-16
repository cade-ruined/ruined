import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MemberBadgeCollection from "@/components/membership/MemberBadgeCollection";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { withFreshApplicationDatabaseRead } from "@/lib/database/server";
import { PREVIEW_BADGE_COLLECTION } from "@/lib/membership/badge-collection-preview";
import { getMemberBadgeCollection } from "@/lib/membership/badge-collection-repository";
import { getMembershipPageContext } from "@/lib/membership/page-context";

export const metadata: Metadata = { title: "Your Badges | Ruined", description: "Your Ruined badges, progress, and earned achievements." };
export const dynamic = "force-dynamic";

export default async function MyBadgesPage() {
  const context = await getMembershipPageContext(PREVIEW_BADGE_COLLECTION,
    authUserId => withFreshApplicationDatabaseRead("member-badge-collection", () => getMemberBadgeCollection(authUserId)), "badges");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberBadgeCollection key={context.data.ownerId} initialCollection={context.data} preview={context.state === "preview"} />;
}
