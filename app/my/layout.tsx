import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import MemberPreviewSwitcher from "@/components/membership/MemberPreviewSwitcher";
import { MEMBER_PREVIEW_COOKIE, memberPreviewScenario } from "@/lib/membership/preview-scenarios";

import MemberJourneyShell from "@/components/membership/MemberJourneyShell";
import MemberSessionContinuity from "@/components/membership/MemberSessionContinuity";
import MemberPortraitState from "@/components/membership/MemberPortraitState";
import MemberTimelineDraftState from "@/components/membership/MemberTimelineDraftState";
import { resolveCurrentPlatformSession } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOperatorRole, type OperatorRole } from "@/lib/platform/repository";
import { isMyRuinedVisible } from "@/lib/platform/visibility";
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
  let operatorRole: OperatorRole | null = scenario === "operator" ? "ops_admin" : null;
  if (viewer) {
    try {
      operatorRole = await getOperatorRole(viewer.authUserId);
    } catch (error) {
      console.error("Member navigation permissions could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return (
    <MemberSessionContinuity enabled={session?.status === "authenticated" || session?.status === "unavailable"} ownerId={viewer?.authUserId} initiallyUnavailable={session?.status === "unavailable"}>
    <MemberPortraitState ownerId={viewer?.authUserId}>
    <MemberTimelineDraftState ownerId={viewer?.authUserId} temporarilyUnavailable={session?.status === "unavailable"}>
    <MemberJourneyShell
      configuration={configuration}
      operatorRole={operatorRole}
      viewerLabel={configuration.mode === "preview" ? "Preview member" : viewer?.email}
    >
      {scenario ? <MemberPreviewSwitcher scenario={scenario} /> : null}
      {children}
    </MemberJourneyShell>
    </MemberTimelineDraftState>
    </MemberPortraitState>
    </MemberSessionContinuity>
  );
}
