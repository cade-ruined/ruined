import { redirect } from "next/navigation";

import MemberSection from "@/components/platform/MemberSection";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { hasActiveMemberAccess } from "@/lib/platform/model";
import { getMemberPageContext } from "@/lib/platform/page-data";

export const dynamic = "force-dynamic";

export default async function MyArtifactsPage() {
  const context = await getMemberPageContext();
  if (context.state === "signed_out") redirect("/my/access");
  if (
    context.state !== "preview" &&
    context.member &&
    !hasActiveMemberAccess(context.member)
  ) {
    redirect("/my/account");
  }
  return context.member ? (
    <MemberSection member={context.member} section="artifacts" />
  ) : (
    <PlatformUnavailable accessHref="/my/access" />
  );
}
