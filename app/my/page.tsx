import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberHome from "@/components/platform/MemberHome";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { withFreshApplicationDatabaseRead } from "@/lib/database/server";
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
    (authUserId) => withFreshApplicationDatabaseRead("member-home", () => getMemberHome(authUserId)),
    "home",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (context.state === "unavailable" && context.viewer) {
    return <section className="grid min-h-[55vh] content-center py-16 text-[var(--member-ink)]">
      <h1 className="font-[var(--font-display)] text-[clamp(2.5rem,6vw,5rem)] leading-none">Your profile couldn’t load.</h1>
      <p className="mt-6 text-base">Please try again.</p>
      <a className="member-button mt-8 w-fit" href="">Reload profile</a>
    </section>;
  }
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;

  // Product imagery is optional; profiles without a linked Artifact need no shop request.
  const hasArtifactProducts = Boolean(context.data.artifact?.product)
    || context.data.artifacts.some((artifact) => Boolean(artifact.product));
  const products = hasArtifactProducts ? await getProducts() : [];
  const member = resolveMemberHomeArtifactProducts(context.data, products);
  return <MemberHome member={member} preview={context.state === "preview"} />;
}
