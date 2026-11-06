import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorNotificationCenter from "@/components/platform/OperatorNotificationCenter";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsNotificationCenter } from "@/lib/platform/ops-notification-repository";
import { getOperatorAccessContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function OperationsNotificationsPage() {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state === "preview") {
    return <OperatorNotificationCenter data={{ blocks: [], circles: [], history: [], members: [] }} preview />;
  }
  if (context.state === "unavailable" || !context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;
  try {
    const data = await getOpsNotificationCenter(context.viewer.authUserId);
    return <OperatorNotificationCenter data={data} />;
  } catch (error) {
    console.error("Operations notification center could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
