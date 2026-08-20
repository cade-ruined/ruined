import { redirect } from "next/navigation";

import MemberSection from "@/components/platform/MemberSection";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMemberPageContext } from "@/lib/platform/page-data";

export const dynamic = "force-dynamic";

export default async function MyAccountPage() {
  const context = await getMemberPageContext();
  if (context.state === "signed_out") redirect("/my/access");
  return context.member ? (
    <MemberSection member={context.member} section="account" />
  ) : (
    <PlatformUnavailable accessHref="/my/access" />
  );
}
