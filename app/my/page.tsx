import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberHome from "@/components/platform/MemberHome";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_HOME } from "@/lib/membership/preview";
import { getMemberHome } from "@/lib/membership/repository";

export const metadata: Metadata = {
  title: "Ruined Membership",
  description: "The private Ruined member experience.",
};
export const dynamic = "force-dynamic";

export default async function MyRuinedPage() {
  const context = await getMembershipPageContext(
    PREVIEW_MEMBER_HOME,
    getMemberHome,
    "home",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;

  return <MemberHome member={context.data} />;
}
