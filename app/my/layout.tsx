import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PlatformShell from "@/components/platform/PlatformShell";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOperatorRole, type OperatorRole } from "@/lib/platform/repository";
import { isMyRuinedVisible } from "@/lib/platform/visibility";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export const dynamic = "force-dynamic";

export default async function MyRuinedLayout({ children }: { children: React.ReactNode }) {
  if (!isMyRuinedVisible()) notFound();

  const configuration = getPlatformConfiguration();
  const viewer = configuration.mode === "connected" ? await getCurrentPlatformViewer() : null;
  let operatorRole: OperatorRole | null = configuration.mode === "preview" ? "ops_admin" : null;
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
    <PlatformShell
      configuration={configuration}
      operatorRole={operatorRole}
      surface="member"
      viewerLabel={configuration.mode === "preview" ? "Preview member" : viewer?.email}
    >
      {children}
    </PlatformShell>
  );
}
