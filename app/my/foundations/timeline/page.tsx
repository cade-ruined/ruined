import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberAccessNotice from "@/components/membership/MemberAccessNotice";
import RuinedTimeline from "@/components/membership/RuinedTimeline";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { isFoundationsAvailableToMember } from "@/lib/foundations/availability";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_IDENTITY, PREVIEW_MEMBER_TIMELINE } from "@/lib/membership/preview";
import { getMemberIdentity, getMemberTimeline } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Private timeline | Foundations" };
export const dynamic = "force-dynamic";

export default async function MyTimelinePage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_IDENTITY, getMemberIdentity, "Foundations timeline");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  if (!await isFoundationsAvailableToMember(context.state === "authenticated" ? context.viewer?.authUserId : null)) redirect("/my/foundations");
  const access = deriveMemberAccessPolicy(context.data);
  const writable = memberCan(access, "foundations.write");
  if (!writable && !memberCan(access, "foundations.revisit")) return <MemberAccessNotice access={access} />;

  if (context.state === "preview") {
    return <RuinedTimeline initialTimeline={PREVIEW_MEMBER_TIMELINE} preview writable={false} />;
  }
  if (!context.viewer) return <PlatformUnavailable accessHref="/my/access" />;

  try {
    // The Foundations exercise reads only the member's private milestones.
    // Its existing adapter keeps those moments in Journal without publishing.
    const timeline = await getMemberTimeline(context.viewer.authUserId);
    return timeline
      ? <RuinedTimeline initialTimeline={timeline} writable={writable} />
      : <PlatformUnavailable accessHref="/my/access" />;
  } catch (error) {
    console.error("Private Foundations timeline could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/my/access" />;
  }
}
