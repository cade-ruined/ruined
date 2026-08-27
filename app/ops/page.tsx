import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OpsOverview from "@/components/platform/OpsOverview";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsOverviewData } from "@/lib/platform/ops-operating-repository";
import { PREVIEW_OPS_OVERVIEW } from "@/lib/platform/ops-preview";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") return <OpsOverview data={PREVIEW_OPS_OVERVIEW} />;
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const data = await getOpsOverviewData(context.viewer.authUserId);
    return <OpsOverview data={data} />;
  } catch (error) {
    console.error("Operations overview could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
