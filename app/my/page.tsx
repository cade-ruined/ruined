import type { Metadata } from "next";
import { redirect } from "next/navigation";

import RuinedTimeline from "@/components/membership/RuinedTimeline";
import { memberCan } from "@/lib/membership/access-policy";
import MemberHome from "@/components/platform/MemberHome";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { resolveMemberHomeArtifactProducts } from "@/lib/membership/artifact-products";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_HOME, PREVIEW_MEMBER_TIMELINE } from "@/lib/membership/preview";
import { getMemberHome, getMemberTimeline } from "@/lib/membership/repository";
import { getProducts } from "@/lib/shopify";

export const metadata: Metadata = {
  title: "Your Profile | Ruined",
  description: "Your private Ruined member profile, Circle, artifacts, and experiences.",
};
export const dynamic = "force-dynamic";

export default async function MyRuinedPage() {
  const context = await getMembershipPageContext(
    PREVIEW_MEMBER_HOME,
    getMemberHome,
    "home",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;

  const member = resolveMemberHomeArtifactProducts(context.data, await getProducts());
  let timeline = context.state === "preview" ? PREVIEW_MEMBER_TIMELINE : null;
  if (context.viewer && (memberCan(member.access, "foundations.write") || memberCan(member.access, "foundations.revisit"))) {
    try { timeline = await getMemberTimeline(context.viewer.authUserId); }
    catch { /* The rest of the profile remains available if Timeline cannot load. */ }
  }
  const hasTimeline = memberCan(member.access, "foundations.write") || memberCan(member.access, "foundations.revisit");
  return <MemberHome member={member} preview={context.state === "preview"} timeline={hasTimeline && timeline ? <RuinedTimeline initialTimeline={timeline} preview={context.state === "preview"} writable={context.state === "authenticated" && memberCan(member.access, "foundations.write")} /> : undefined} />;
}
