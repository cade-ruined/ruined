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
import { PREVIEW_OPS_CIRCLES } from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "Blocks" };
export const dynamic = "force-dynamic";

export default async function OperationsBlocksPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") {
    return <PlatformUnavailable reason="operator_access" />;
  }
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") {
    const previewBlocks: OpsBlockSummary[] = Array.from(new Set(PREVIEW_OPS_CIRCLES.map((circle) => circle.blockId).filter((id): id is string => Boolean(id)))).map((id) => {
      const blockCircles = PREVIEW_OPS_CIRCLES.filter((circle) => circle.blockId === id);
      return {
        id,
        name: blockCircles[0].blockName ?? "Block 01",
        slug: (blockCircles[0].blockName ?? "Block 01").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        status: blockCircles.length >= 2 ? "active" : "forming",
        currentCircles: blockCircles.length,
        circles: blockCircles.map(({ id: circleId, name, status }) => ({ id: circleId, name, status })),
      };
    });
    const previewCircles = PREVIEW_OPS_CIRCLES.map((circle) => ({ ...circle, blockStatus: previewBlocks.find((block) => block.id === circle.blockId)?.status ?? null }));
    return <OpsBlocks blocks={previewBlocks} dashboard={context.dashboard} actions={<OpsBlockActions circles={previewCircles} initialBlocks={previewBlocks} preview />} />;
  }

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
