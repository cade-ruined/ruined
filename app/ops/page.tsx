import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OpsOverview from "@/components/platform/OpsOverview";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import {
  getOpsOverviewData,
  OpsOperatingRepositoryError,
} from "@/lib/platform/ops-operating-repository";
import { PREVIEW_OPS_OVERVIEW } from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const configuration = getPlatformConfiguration();
  if (configuration.mode === "preview") return <OpsOverview data={PREVIEW_OPS_OVERVIEW} />;
  if (configuration.mode === "unavailable") {
    return <PlatformUnavailable accessHref="/ops/access" />;
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) redirect("/ops/access");

  try {
    const data = await getOpsOverviewData(viewer.authUserId);
    return <OpsOverview data={data} />;
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError && error.code === "forbidden") {
      return <PlatformUnavailable reason="operator_access" />;
    }
    console.error("Operations overview could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
