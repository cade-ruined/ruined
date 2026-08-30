import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberArtifactArchive from "@/components/membership/MemberArtifactArchive";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { resolveMemberArtifactProducts } from "@/lib/membership/artifact-products";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_ARTIFACTS } from "@/lib/membership/preview";
import { getMemberArtifacts } from "@/lib/membership/repository";
import { getProducts } from "@/lib/shopify";

export const metadata: Metadata = { title: "Artifacts | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyArtifactsPage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_ARTIFACTS, getMemberArtifacts, "artifacts");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const artifacts = resolveMemberArtifactProducts(context.data, await getProducts());
  return <MemberArtifactArchive artifacts={artifacts} />;
}
