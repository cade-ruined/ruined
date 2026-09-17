import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import MemberPreviewSwitcher from "@/components/membership/MemberPreviewSwitcher";
import { MEMBER_PREVIEW_COOKIE, memberPreviewScenario } from "@/lib/membership/preview-scenarios";

import MemberJourneyShell from "@/components/membership/MemberJourneyShell";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOperatorRole, type OperatorRole } from "@/lib/platform/repository";
import { isMyRuinedVisible } from "@/lib/platform/visibility";
import { privateSharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  robots: { follow: false, index: false },
};

export const dynamic = "force-dynamic";

export default async function MyRuinedLayout({ children }: { children: React.ReactNode }) {
  if (!isMyRuinedVisible()) notFound();

  const configuration = getPlatformConfiguration();
  const viewer = configuration.mode === "connected" ? await getCurrentPlatformViewer() : null;
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
    <MemberJourneyShell
      configuration={configuration}
      operatorRole={operatorRole}
      viewerLabel={configuration.mode === "preview" ? "Preview member" : viewer?.email}
    >
      {scenario ? <MemberPreviewSwitcher scenario={scenario} /> : null}
      {children}
    </MemberJourneyShell>
  );
}
