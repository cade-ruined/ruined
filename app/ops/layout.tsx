import type { Metadata } from "next";

import PlatformShell from "@/components/platform/PlatformShell";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOperatorRole, type OperatorRole } from "@/lib/platform/repository";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: { default: "Ruined operations", template: "%s — Ruined operations" },
};
export const dynamic = "force-dynamic";

export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const configuration = getPlatformConfiguration();
  const viewer = configuration.mode === "connected" ? await getCurrentPlatformViewer() : null;
  let operatorRole: OperatorRole | null = configuration.mode === "preview" ? "ops_admin" : null;
  if (viewer) {
    try {
      operatorRole = await getOperatorRole(viewer.authUserId);
    } catch (error) {
      console.error("Operator navigation access could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return (
    <PlatformShell
      configuration={configuration}
      operatorRole={operatorRole}
      surface="ops"
      viewerLabel={configuration.mode === "preview" ? "Preview operator" : viewer?.email}
    >
      {children}
    </PlatformShell>
  );
}
