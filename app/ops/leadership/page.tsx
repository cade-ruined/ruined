import { redirect } from "next/navigation";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import OperatorLeadershipManager from "@/components/platform/OperatorLeadershipManager";
import { getOperatorAccessContext } from "@/lib/platform/page-data";
import { getLeadershipDirectory } from "@/lib/platform/leadership-repository";
import { PREVIEW_LEADERSHIP } from "@/lib/platform/leadership-preview";
import { OpsRepositoryError } from "@/lib/platform/ops-repository";
export const dynamic = "force-dynamic";
export default async function LeadershipPage() {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state === "preview") return <OperatorPageFrame title="Leadership"><OperatorLeadershipManager initialDirectory={PREVIEW_LEADERSHIP} preview /></OperatorPageFrame>;
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;
  try {
    const directory = await getLeadershipDirectory(context.viewer.authUserId);
    return <OperatorPageFrame title="Leadership"><OperatorLeadershipManager initialDirectory={directory} /></OperatorPageFrame>;
  } catch (error) {
    if (error instanceof OpsRepositoryError && error.code === "forbidden") return <OperatorPageFrame title="Leadership"><p>{error.message} Ask an Administrator to configure your responsibility.</p></OperatorPageFrame>;
    console.error("Leadership page unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
