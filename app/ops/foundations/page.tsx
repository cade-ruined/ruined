import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import OpsSection from "@/components/platform/OpsSection";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Foundations" };
export const dynamic = "force-dynamic";

export default async function OperationsFoundationsPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") {
    return <PlatformUnavailable reason="operator_access" />;
  }
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  return (
    <>
    {context.role === "ops_admin" ? <div className="mb-4 flex justify-end"><Link className="operator-button" href="/ops/practice">The Work releases &amp; recap emails →</Link></div> : null}
    <OpsSection
      canPlaceMembers={context.role === "ops_admin"}
      configuration={context.configuration}
      dashboard={context.dashboard}
      section="foundations"
    />
    </>
  );
}
