import { redirect } from "next/navigation";

import { OpsInvitationActions } from "@/components/platform/OpsActions";
import OpsSection from "@/components/platform/OpsSection";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const dynamic = "force-dynamic";
export default async function OperationsMembersPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable title="Operator access required." />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  const actions = context.role === "ops_admin" && context.viewer
    ? <OpsInvitationActions />
    : undefined;

  return (
    <OpsSection
      actions={actions}
      configuration={context.configuration}
      dashboard={context.dashboard}
      section="members"
    />
  );
}
