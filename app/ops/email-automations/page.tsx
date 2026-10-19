import type { Metadata } from "next";
import { redirect } from "next/navigation";
import OperatorEmailAutomations from "@/components/platform/OperatorEmailAutomations";
import OperatorMessagesTabs from "@/components/platform/OperatorMessagesTabs";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getCommunicationsChannelPreviewCatalog } from "@/lib/communications/communications-channel-catalog";
import { getOperatorAccessContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Communications" };
export const dynamic = "force-dynamic";

export default async function OperationsEmailAutomationsPage() {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state === "preview") return <OperatorEmailAutomations preview previewCommunications={getCommunicationsChannelPreviewCatalog()} />;
  if (context.state !== "authenticated" || !context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;
  if (context.role !== "ops_admin") return <OperatorPageFrame title="Communications"><OperatorMessagesTabs active="automations" /><section className="operator-bento-card"><h2 className="operator-page-heading">Admin access required.</h2><p className="mt-3 text-sm leading-relaxed text-[color:var(--operator-muted)]">Communication management is available to Ruined admins. Your other operations tools are still available.</p></section></OperatorPageFrame>;
  return <OperatorEmailAutomations />;
}
