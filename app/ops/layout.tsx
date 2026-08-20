import type { Metadata } from "next";

import PlatformShell from "@/components/platform/PlatformShell";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: { default: "Ruined operations", template: "%s — Ruined operations" },
};
export const dynamic = "force-dynamic";

export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const configuration = getPlatformConfiguration();
  const viewer = configuration.mode === "connected" ? await getCurrentPlatformViewer() : null;

  return (
    <PlatformShell
      configuration={configuration}
      surface="ops"
      viewerLabel={configuration.mode === "preview" ? "Preview operator" : viewer?.email}
    >
      {children}
    </PlatformShell>
  );
}
