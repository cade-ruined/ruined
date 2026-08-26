import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberLearningLibrary from "@/components/membership/MemberLearningLibrary";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_LEARNING } from "@/lib/membership/preview";
import { getMemberLearning } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Learn | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyLearnPage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_LEARNING, getMemberLearning, "learning library");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberLearningLibrary learning={context.data} />;
}
