import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberHome from "@/components/platform/MemberHome";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { resolveMemberHomeArtifactProducts } from "@/lib/membership/artifact-products";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_HOME } from "@/lib/membership/preview";
import { getMemberHome } from "@/lib/membership/repository";
import { getProducts } from "@/lib/shopify";

export const metadata: Metadata = {
  title: "Your Profile | Ruined",
  description: "Your private Ruined member profile, Circle, artifacts, and experiences.",
};
export const dynamic = "force-dynamic";

export default async function MyRuinedPage() {
  const context = await getMembershipPageContext(
    PREVIEW_MEMBER_HOME,
    getMemberHome,
    "home",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;

  const member = resolveMemberHomeArtifactProducts(context.data, await getProducts());
  return <MemberHome member={member} />;
}
