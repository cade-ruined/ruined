import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorEmailComposer from "@/components/platform/OperatorEmailComposer";
import OperatorMessagesTabs from "@/components/platform/OperatorMessagesTabs";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getAdminEmailConfiguration } from "@/lib/communications/admin-email-ai";
import { getAdminEmailCenter } from "@/lib/communications/admin-email-repository";
import { getOperatorAccessContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Emails" };
export const dynamic = "force-dynamic";

export default async function OperationsEmailsPage() {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state === "preview") return <OperatorEmailComposer drafts={[]} configuration={{ aiReady: false, deliveryReady: false, marketingReady: false, missing: [] }} preview />;
  if (context.state !== "authenticated" || !context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;
  if (context.role !== "ops_admin") return <OperatorPageFrame title="Emails"><OperatorMessagesTabs active="emails" /><section className="operator-bento-card"><h2 className="operator-page-heading">Admin access required.</h2><p className="mt-3 text-sm leading-relaxed text-black/60">Email creation and sending are available to Ruined admins. Your other operations tools are still available.</p></section></OperatorPageFrame>;

  try {
    const center = await getAdminEmailCenter(context.viewer.authUserId);
    return <OperatorEmailComposer drafts={center.drafts} configuration={getAdminEmailConfiguration()} />;
  } catch (error) {
    console.error("Admin email workspace could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
