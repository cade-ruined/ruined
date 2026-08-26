import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OpsSection from "@/components/platform/OpsSection";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Access & Billing" };
export const dynamic = "force-dynamic";

export default async function OperationsAccessBillingPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") {
    return <PlatformUnavailable title="Operator access required." />;
  }
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  return (
    <OpsSection
      configuration={context.configuration}
      dashboard={context.dashboard}
      section="access-billing"
    />
  );
}
