import type { Metadata } from "next";

import AccessPage from "@/components/platform/AccessPage";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = { title: "Operations access" };
export const dynamic = "force-dynamic";

export default function OperationsAccessPage() {
  const configuration = getPlatformConfiguration();
  return <AccessPage audience="ops" enabled={configuration.mode === "connected"} />;
}
