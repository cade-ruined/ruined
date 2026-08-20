import { redirect } from "next/navigation";

import OpsSection from "@/components/platform/OpsSection";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const dynamic = "force-dynamic";
export default async function OperationsSyncPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable title="Operator access required." />;
  return context.dashboard ? <OpsSection configuration={context.configuration} dashboard={context.dashboard} section="sync" /> : <PlatformUnavailable accessHref="/ops/access" />;
}
