import type { Metadata } from "next";
import { redirect } from "next/navigation";

import FoundationsTimelineWorksheet from "@/components/membership/FoundationsTimelineWorksheet";
import MemberAccessNotice from "@/components/membership/MemberAccessNotice";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getSupportAccessUrl } from "@/lib/auth/support-return";
import { isFoundationsAvailableToMember } from "@/lib/foundations/availability";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_IDENTITY, PREVIEW_MEMBER_TIMELINE } from "@/lib/membership/preview";
import { getMemberIdentity, getMemberTimeline } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Ruined Timeline — Part I | Foundations" };
export const dynamic = "force-dynamic";

const ACCESS_URL = getSupportAccessUrl("/my/foundations/timeline/part-1");

export default async function FoundationsTimelinePartOnePage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_IDENTITY, getMemberIdentity, "Foundations timeline Part I");
  if (context.state === "signed_out") redirect(ACCESS_URL);
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref={ACCESS_URL} />;
  if (!await isFoundationsAvailableToMember(context.state === "authenticated" ? context.viewer?.authUserId : null)) redirect("/my/foundations");
  const access = deriveMemberAccessPolicy(context.data);
  const writable = memberCan(access, "foundations.write");
  if (!writable && !memberCan(access, "foundations.revisit")) return <MemberAccessNotice access={access} />;

  if (context.state === "preview") {
    return <FoundationsTimelineWorksheet initialTimeline={PREVIEW_MEMBER_TIMELINE} preview writable={false} />;
  }
  if (!context.viewer) return <PlatformUnavailable accessHref={ACCESS_URL} />;

  try {
    const timeline = await getMemberTimeline(context.viewer.authUserId);
    return timeline
      ? <FoundationsTimelineWorksheet initialTimeline={timeline} writable={writable} ownerId={context.viewer.authUserId} />
      : <PlatformUnavailable accessHref={ACCESS_URL} />;
  } catch (error) {
    console.error("Private Foundations Part I timeline could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref={ACCESS_URL} />;
  }
}
