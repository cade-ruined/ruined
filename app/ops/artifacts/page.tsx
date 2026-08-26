import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorArtifactQueue from "@/components/platform/OperatorArtifactQueue";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsArtifactQueue } from "@/lib/platform/ops-operating-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { PREVIEW_OPS_ARTIFACTS } from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "Artifacts" };
export const dynamic = "force-dynamic";

export default async function OperationsArtifactsPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") return <OperatorArtifactQueue artifacts={PREVIEW_OPS_ARTIFACTS} />;
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const artifacts = await getOpsArtifactQueue(context.viewer.authUserId);
    return <OperatorArtifactQueue artifacts={artifacts} />;
  } catch (error) {
    console.error("Operations Artifact queue could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
