import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorAnnouncements from "@/components/platform/OperatorAnnouncements";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsAnnouncements } from "@/lib/platform/ops-operating-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { PREVIEW_OPS_ANNOUNCEMENTS } from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "Announcements" };
export const dynamic = "force-dynamic";

export default async function OperationsAnnouncementsPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") {
    return <OperatorAnnouncements announcements={PREVIEW_OPS_ANNOUNCEMENTS} canManage />;
  }
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const result = await getOpsAnnouncements(context.viewer.authUserId);
    return <OperatorAnnouncements announcements={result.announcements} canManage={result.canManage} />;
  } catch (error) {
    console.error("Operations announcements could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
