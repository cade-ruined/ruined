import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import MemberPreviewSwitcher from "@/components/membership/MemberPreviewSwitcher";
import { MEMBER_PREVIEW_COOKIE, memberPreviewScenario, isRegistrationPreview } from "@/lib/membership/preview-scenarios";

import MemberJourneyShell from "@/components/membership/MemberJourneyShell";
import MemberSessionContinuity from "@/components/membership/MemberSessionContinuity";
import MemberBadgeCelebration from "@/components/membership/MemberBadgeCelebration";
import MemberPortraitState from "@/components/membership/MemberPortraitState";
import MemberTimelineDraftState from "@/components/membership/MemberTimelineDraftState";
import MemberJournalDraftState from "@/components/membership/MemberJournalDraftState";
import MemberPracticeDraftState from "@/components/membership/MemberPracticeDraftState";
import { resolveCurrentPlatformSession } from "@/lib/auth/page-session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import type { OperatorRole } from "@/lib/platform/repository";
import { getOperatorRole } from "@/lib/platform/page-reads";
import { isMyRuinedVisible } from "@/lib/platform/visibility";
import { getMemberRegistration } from "@/lib/membership/page-reads";
import { canBrowseMemberDirectory } from "@/lib/membership/member-search-repository";
import { hasEligibleExplicitExperienceInvitations } from "@/lib/platform/experience-member-access";
import { privateSharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  manifest: "/my/manifest.webmanifest",
  robots: { follow: false, index: false },
};

export const dynamic = "force-dynamic";

export default async function MyRuinedLayout({ children }: { children: React.ReactNode }) {
  if (!isMyRuinedVisible()) notFound();

  const configuration = getPlatformConfiguration();
  const session = configuration.mode === "connected" ? await resolveCurrentPlatformSession() : null;
  const viewer = session?.status === "authenticated" ? session.viewer : null;
  const scenario = configuration.mode === "preview" ? memberPreviewScenario((await cookies()).get(MEMBER_PREVIEW_COOKIE)?.value) : null;
  let registrationOnly = Boolean(scenario && isRegistrationPreview(scenario));
  let invitedCalendarAvailable = false;
  let memberDirectoryAvailable = false;
  let operatorRole: OperatorRole | null = scenario === "operator" ? "ops_admin" : null;
  if (viewer) {
    // These independent navigation reads must not wait on one another.
    await Promise.all([
      (async () => {
        try {
          const registration = await getMemberRegistration(viewer.authUserId);
          registrationOnly = Boolean(registration && registration.state !== "activated");
          const [calendar, directory] = await Promise.all([
            registration?.state === "registered" && registration.ready
              ? hasEligibleExplicitExperienceInvitations(viewer.authUserId) : false,
            registrationOnly ? canBrowseMemberDirectory(viewer.authUserId) : false,
          ]);
          invitedCalendarAvailable = calendar;
          memberDirectoryAvailable = directory;
        } catch (error) {
          registrationOnly = true;
          invitedCalendarAvailable = false;
          memberDirectoryAvailable = false;
          console.error("Member registration navigation could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
        }
      })(),
      (async () => {
        try {
          operatorRole = await getOperatorRole(viewer.authUserId);
        } catch (error) {
          console.error("Member navigation permissions could not be loaded", {
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        }
      })(),
    ]);
  }

  return (
    <MemberSessionContinuity enabled={session?.status === "authenticated" || session?.status === "unavailable"} ownerId={viewer?.authUserId} initiallyUnavailable={session?.status === "unavailable"}
      celebration={viewer && !registrationOnly ? <MemberBadgeCelebration key={viewer.authUserId} ownerId={viewer.authUserId} /> : null}>
    <MemberPortraitState ownerId={viewer?.authUserId}>
    <MemberTimelineDraftState ownerId={viewer?.authUserId} temporarilyUnavailable={session?.status === "unavailable"}>
    <MemberJournalDraftState ownerId={viewer?.authUserId} temporarilyUnavailable={session?.status === "unavailable"}>
    <MemberPracticeDraftState ownerId={viewer?.authUserId} temporarilyUnavailable={session?.status === "unavailable"}>
    <MemberJourneyShell
      configuration={configuration}
      operatorRole={operatorRole}
      registrationOnly={registrationOnly}
      invitedCalendarAvailable={invitedCalendarAvailable}
      memberDirectoryAvailable={memberDirectoryAvailable}
      viewerLabel={configuration.mode === "preview" ? "Preview member" : viewer?.email}
    >
      {scenario ? <MemberPreviewSwitcher scenario={scenario} /> : null}
      {children}
    </MemberJourneyShell>
    </MemberPracticeDraftState>
    </MemberJournalDraftState>
    </MemberTimelineDraftState>
    </MemberPortraitState>
    </MemberSessionContinuity>
  );
}
