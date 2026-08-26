import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberHome from "@/components/platform/MemberHome";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMemberPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = {
  title: "Ruined Membership",
  description: "The private Ruined member experience.",
};
export const dynamic = "force-dynamic";

export default async function MyRuinedPage() {
  const context = await getMemberPageContext();
  if (context.state === "signed_out") redirect("/my/access");
  if (!context.member) return <PlatformUnavailable accessHref="/my/access" />;

  return <MemberHome configuration={context.configuration} member={context.member} />;
}
