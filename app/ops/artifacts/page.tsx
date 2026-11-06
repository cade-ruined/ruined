import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorArtifactAdmin from "@/components/platform/OperatorArtifactAdmin";
import OperatorArtifactQueue from "@/components/platform/OperatorArtifactQueue";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsArtifactControlData } from "@/lib/platform/ops-artifact-repository";
import { getOpsArtifactQueue } from "@/lib/platform/ops-operating-repository";
import { getOperatorAccessContext } from "@/lib/platform/page-data";
import {
  PREVIEW_OPS_ARTIFACT_CONTROLS,
  PREVIEW_OPS_ARTIFACTS,
} from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "Artifacts" };
export const dynamic = "force-dynamic";

export default async function OperationsArtifactsPage() {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state === "unavailable") return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") {
    return (
      <OperatorArtifactQueue
        artifacts={PREVIEW_OPS_ARTIFACTS}
        controls={<OperatorArtifactAdmin artifacts={PREVIEW_OPS_ARTIFACTS} data={PREVIEW_OPS_ARTIFACT_CONTROLS} preview />}
        preview
      />
    );
  }
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const [artifacts, artifactControls] = await Promise.all([
      getOpsArtifactQueue(context.viewer.authUserId),
      getOpsArtifactControlData(context.viewer.authUserId),
    ]);
    return (
      <OperatorArtifactQueue
        artifacts={artifacts}
        controls={<OperatorArtifactAdmin artifacts={artifacts} data={artifactControls} />}
      />
    );
  } catch (error) {
    console.error("Operations Artifact queue could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
