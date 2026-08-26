import { redirect } from "next/navigation";

import { OpsCircleActions } from "@/components/platform/OpsActions";
import OpsSection from "@/components/platform/OpsSection";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsCircleSummaries, type OpsCircleSummary } from "@/lib/platform/ops-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const dynamic = "force-dynamic";
export default async function OperationsCirclesPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  let circles: OpsCircleSummary[] | undefined;
  if (context.role === "ops_admin" && context.viewer) {
    try {
      circles = await getOpsCircleSummaries(context.viewer.authUserId);
    } catch (error) {
      console.error("Operations Circle administration could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  const actions = circles
    ? <OpsCircleActions initialCircles={circles} members={context.dashboard.members} />
    : undefined;

  return (
    <OpsSection
      actions={actions}
      circles={circles}
      configuration={context.configuration}
      dashboard={context.dashboard}
      section="circles"
    />
  );
}
