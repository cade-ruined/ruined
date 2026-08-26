import type { Metadata } from "next";
import { redirect } from "next/navigation";

import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import OperatorSystemHealth from "@/components/platform/OperatorSystemHealth";
import { getOpsSystemHealth } from "@/lib/platform/ops-operating-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { PREVIEW_OPS_SYSTEM } from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "System" };
export const dynamic = "force-dynamic";

export default async function OperationsSystemPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable title="Operator access required." />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") return <OperatorSystemHealth health={PREVIEW_OPS_SYSTEM} canRetry />;
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const result = await getOpsSystemHealth(context.viewer.authUserId, context.configuration);
    return <OperatorSystemHealth health={result.health} canRetry={result.canRetry} />;
  } catch (error) {
    console.error("Operations system health could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
