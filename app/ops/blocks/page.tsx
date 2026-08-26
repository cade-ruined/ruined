import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OpsBlockActions } from "@/components/platform/OpsActions";
import OpsBlocks from "@/components/platform/OpsBlocks";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import {
  getOpsBlockSummaries,
  getOpsCircleSummaries,
  type OpsBlockSummary,
  type OpsCircleSummary,
} from "@/lib/platform/ops-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Blocks" };
export const dynamic = "force-dynamic";

export default async function OperationsBlocksPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") {
    return <PlatformUnavailable title="Operator access required." />;
  }
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  let blocks: OpsBlockSummary[] | undefined;
  let circles: OpsCircleSummary[] | undefined;
  if (context.role === "ops_admin" && context.viewer) {
    try {
      [blocks, circles] = await Promise.all([
        getOpsBlockSummaries(context.viewer.authUserId),
        getOpsCircleSummaries(context.viewer.authUserId),
      ]);
    } catch (error) {
      console.error("Operations Block administration could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  const actions = blocks && circles
    ? <OpsBlockActions circles={circles} initialBlocks={blocks} />
    : undefined;

  return <OpsBlocks actions={actions} blocks={blocks} dashboard={context.dashboard} />;
}
