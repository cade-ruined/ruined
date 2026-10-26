import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberExperiences from "@/components/membership/MemberExperiences";
import MemberWelcomeCalendarVisit from "@/components/membership/MemberWelcomeCalendarVisit";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_EXPERIENCES } from "@/lib/membership/preview";
import { getMemberExperiences } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Calendar | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyExperiencesPage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_EXPERIENCES, getMemberExperiences, "experiences");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const profileEnabled = context.state === "authenticated" && !context.invitedCalendarOnly;
  const calendar = <MemberExperiences initialExperiences={context.data} writable={profileEnabled} />;
  return profileEnabled && context.viewer ? <>
    <MemberWelcomeCalendarVisit ownerId={context.viewer.authUserId} />
    {calendar}
  </> : calendar;
}
