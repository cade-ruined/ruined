import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberArtifactArchive from "@/components/membership/MemberArtifactArchive";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_ARTIFACTS } from "@/lib/membership/preview";
import { getMemberArtifacts } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Artifacts | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyArtifactsPage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_ARTIFACTS, getMemberArtifacts, "artifacts");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberArtifactArchive artifacts={context.data} />;
}
