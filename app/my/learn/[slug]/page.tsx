import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import MemberLearningArticle from "@/components/membership/MemberLearningArticle";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import {
  getPreviewMemberLearningResource,
  PREVIEW_MEMBER_LEARNING,
  PREVIEW_MEMBER_LEARNING_DETAILS,
} from "@/lib/membership/preview";
import {
  getMemberLearning,
  getMemberLearningResource,
} from "@/lib/membership/repository";
import type { MemberLearningSnapshot } from "@/lib/membership/model";

export const metadata: Metadata = { title: "Learn | Ruined Membership" };
export const dynamic = "force-dynamic";

function learningResources(learning: MemberLearningSnapshot) {
  return [
    ...learning.collections.flatMap((collection) => collection.resources),
    ...learning.uncollected,
  ];
}

export default async function MyLearningResourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const previewResource = getPreviewMemberLearningResource(slug);
  const context = await getMembershipPageContext(
    {
      related: learningResources(PREVIEW_MEMBER_LEARNING),
      resource: previewResource ?? PREVIEW_MEMBER_LEARNING_DETAILS["welcome-to-ruined"],
    },
    async (authUserId) => {
      const [resource, learning] = await Promise.all([
        getMemberLearningResource(authUserId, slug),
        getMemberLearning(authUserId),
      ]);
      if (!resource || !learning) return null;
      return { related: learningResources(learning), resource };
    },
    "learning resource",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (context.state === "preview" && !previewResource) notFound();
  if (context.state === "authenticated" && !context.data) notFound();
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberLearningArticle related={context.data.related} resource={context.data.resource} />;
}
