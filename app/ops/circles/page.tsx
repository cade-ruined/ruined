import { redirect } from "next/navigation";

import { OpsCircleActions } from "@/components/platform/OpsActions";
import OpsCircleManagementActions from "@/components/platform/OpsCircleManagementActions";
import OpsSection from "@/components/platform/OpsSection";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import type { OpsCircleCommunicationItem } from "@/lib/platform/ops-model";
import { getOpsCircleCommunicationDirectory } from "@/lib/platform/ops-operating-repository";
import {
  PREVIEW_OPS_CIRCLE_COMMUNICATIONS,
  PREVIEW_OPS_CIRCLE_MANAGEMENT,
  PREVIEW_OPS_CIRCLES,
} from "@/lib/platform/ops-preview";
import {
  getOpsCircleManagementOptions,
  getOpsCircleSummaries,
  type OpsCircleManagementOptions,
  type OpsCircleSummary,
} from "@/lib/platform/ops-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const dynamic = "force-dynamic";
export default async function OperationsCirclesPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  let circles: OpsCircleSummary[] | undefined;
  let managementOptions: OpsCircleManagementOptions | undefined;
  let communicationCircles: OpsCircleCommunicationItem[] | undefined =
    context.state === "preview" ? PREVIEW_OPS_CIRCLE_COMMUNICATIONS : undefined;
  if (context.state === "preview") {
    circles = PREVIEW_OPS_CIRCLES;
    managementOptions = PREVIEW_OPS_CIRCLE_MANAGEMENT;
  }
  if (context.role === "ops_admin" && context.viewer) {
    try {
      [circles, managementOptions] = await Promise.all([
        getOpsCircleSummaries(context.viewer.authUserId),
        getOpsCircleManagementOptions(context.viewer.authUserId),
      ]);
    } catch (error) {
      console.error("Operations Circle administration could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  if (context.viewer) {
    try {
      communicationCircles = await getOpsCircleCommunicationDirectory(
        context.viewer.authUserId,
      );
    } catch (error) {
      console.error("Operations Circle communications could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  const actions = circles
    ? (
        <div className="grid gap-3">
          <details className="group rounded-[4px] bg-black/[0.035]" open={circles.length === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 marker:content-none">
              <span><strong className="ui-heading block text-lg font-semibold">Members + Circle status</strong><span className="mt-1 block text-xs text-black/45">Create a Circle, place members, or change its active state.</span></span>
              <span aria-hidden="true" className="text-2xl transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="px-5 pb-6">
              <OpsCircleActions initialCircles={circles} members={context.dashboard.members} />
            </div>
          </details>
          {managementOptions ? (
            <details className="group rounded-[4px] bg-black/[0.035]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 marker:content-none">
                <span><strong className="ui-heading block text-lg font-semibold">Shapers + resources</strong><span className="mt-1 block text-xs text-black/45">Assign who holds the Circle and what the room can use.</span></span>
                <span aria-hidden="true" className="text-2xl transition-transform group-open:rotate-45">+</span>
              </summary>
              <div className="px-5 pb-6">
                <OpsCircleManagementActions
                  initialCircles={circles}
                  resources={managementOptions.resources}
                  shapers={managementOptions.shapers}
                />
              </div>
            </details>
          ) : null}
        </div>
      )
    : undefined;

  return (
    <OpsSection
      actions={actions}
      canManageGoogleCommunications={context.state === "authenticated"}
      circles={communicationCircles ?? circles}
      configuration={context.configuration}
      dashboard={context.dashboard}
      section="circles"
    />
  );
}
