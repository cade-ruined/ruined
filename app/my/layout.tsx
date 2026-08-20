import type { Metadata } from "next";

import PlatformShell from "@/components/platform/PlatformShell";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export const dynamic = "force-dynamic";

export default async function MyRuinedLayout({ children }: { children: React.ReactNode }) {
  const configuration = getPlatformConfiguration();
  const viewer = configuration.mode === "connected" ? await getCurrentPlatformViewer() : null;

  return (
    <PlatformShell
      configuration={configuration}
      surface="member"
      viewerLabel={configuration.mode === "preview" ? "Preview member" : viewer?.email}
    >
      {children}
    </PlatformShell>
  );
}
