import type { Metadata } from "next";
import { redirect } from "next/navigation";

import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import OperatorWorkQueue from "@/components/platform/OperatorWorkQueue";
import { getOpsWorkQueue } from "@/lib/platform/ops-operating-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { PREVIEW_OPS_WORK_QUEUE } from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "Operator work" };
export const dynamic = "force-dynamic";

export default async function OperationsWorkPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") return <OperatorWorkQueue queue={PREVIEW_OPS_WORK_QUEUE} />;
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const queue = await getOpsWorkQueue(context.viewer.authUserId);
    return <OperatorWorkQueue queue={queue} />;
  } catch (error) {
    console.error("Operations work queue could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
