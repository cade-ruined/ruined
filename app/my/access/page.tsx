import type { Metadata } from "next";

import AccessPage from "@/components/platform/AccessPage";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = { title: "Access Ruined Membership" };
export const dynamic = "force-dynamic";

export default function MyRuinedAccessPage() {
  const configuration = getPlatformConfiguration();
  return <AccessPage audience="member" enabled={configuration.mode === "connected"} />;
}
