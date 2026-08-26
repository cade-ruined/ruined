import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import MemberLearningArticle from "@/components/membership/MemberLearningArticle";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_LEARNING_DETAIL } from "@/lib/membership/preview";
import { getMemberLearningResource } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Learn | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyLearningResourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await getMembershipPageContext(
    PREVIEW_MEMBER_LEARNING_DETAIL,
    (authUserId) => getMemberLearningResource(authUserId, slug),
    "learning resource",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (context.state === "preview" && slug !== PREVIEW_MEMBER_LEARNING_DETAIL.slug) notFound();
  if (context.state === "authenticated" && !context.data) notFound();
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberLearningArticle resource={context.data} />;
}
