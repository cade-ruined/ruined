import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberProfileEditor from "@/components/membership/MemberProfileEditor";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_PROFILE } from "@/lib/membership/preview";
import { getMemberProfile } from "@/lib/membership/repository";
import { isMemberPhotoStorageConfigured } from "@/lib/membership/photos";
import { getOwnMemberCard } from "@/lib/membership/public-card-repository";
import { memberCardPreviewSnapshot } from "@/lib/membership/public-card-preview";
import { memberCan } from "@/lib/membership/access-policy";

export const metadata: Metadata = { title: "Member Profile | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyProfilePage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_PROFILE, getMemberProfile, "profile");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const card = context.state === "preview" ? memberCardPreviewSnapshot(context.data) : context.viewer ? await getOwnMemberCard(context.viewer.authUserId).catch(() => null) : null;
  return <MemberProfileEditor initialProfile={context.data} initialCard={card} photoStorageReady={context.state === "authenticated" && isMemberPhotoStorageConfigured()} writable={context.state === "authenticated" && memberCan(context.data.access, "profile.write")} preview={context.state === "preview"} />;
}
