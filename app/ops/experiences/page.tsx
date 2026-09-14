import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorExperienceDirectory from "@/components/platform/OperatorExperienceDirectory";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsExperienceManagementDirectory } from "@/lib/platform/ops-experience-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { PREVIEW_OPS_EXPERIENCE_DIRECTORY } from "@/lib/platform/ops-experience-preview";
import OperatorEventAudienceTabs from "@/components/platform/OperatorEventAudienceTabs";
import OperatorCommunityEvents from "@/components/platform/OperatorCommunityEvents";
import { getOpsCommunityEvents } from "@/lib/events/community-event-repository";
import { legacyCommunityEventRecords } from "@/lib/events/community-event-model";

export const metadata: Metadata = { title: "Experiences" };
export const dynamic = "force-dynamic";

export default async function OperationsExperiencesPage({ searchParams }: { searchParams: Promise<{ view?: string; circleId?: string | string[] }> }) {
  const search = await searchParams;
  // A Circle shortcut always stays in member Experiences, even if an old audience query remains.
  const requestedCircleId = search.circleId === undefined ? undefined : typeof search.circleId === "string" ? search.circleId : "";
  const view = requestedCircleId === undefined && search.view === "community" ? "community" : "members";
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;
  const tabs = <OperatorEventAudienceTabs selected={view} canManagePublic={context.role === "ops_admin"} />;
  if (view === "community") {
    if (context.role !== "ops_admin") return <PlatformUnavailable reason="operator_access" />;
    if (context.state === "preview") return <OperatorCommunityEvents navigation={tabs} events={legacyCommunityEventRecords()} preview />;
    if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;
    try {
      const events = await getOpsCommunityEvents(context.viewer.authUserId);
      return <OperatorCommunityEvents navigation={tabs} events={events} />;
    } catch (error) {
      console.error("Public community administration unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
      return <PlatformUnavailable accessHref="/ops/access" />;
    }
  }

  if (context.state === "preview") {
    return (
      <OperatorExperienceDirectory
        key={requestedCircleId ?? "all-experiences"}
        navigation={tabs}
        directory={PREVIEW_OPS_EXPERIENCE_DIRECTORY}
        requestedCircleId={requestedCircleId}
        preview
      />
    );
  }
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const directory = await getOpsExperienceManagementDirectory(context.viewer.authUserId);
    return (
      <OperatorExperienceDirectory
        key={requestedCircleId ?? "all-experiences"}
        navigation={tabs}
        directory={directory}
        requestedCircleId={requestedCircleId}
      />
    );
  } catch (error) {
    console.error("Operations Experience directory could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
