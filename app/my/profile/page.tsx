import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberProfileEditor from "@/components/membership/MemberProfileEditor";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_PROFILE } from "@/lib/membership/preview";
import { getMemberProfile } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Member Profile | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyProfilePage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_PROFILE, getMemberProfile, "profile");
  if (context.state === "signed_out") redirect("/my/access");
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberProfileEditor initialProfile={context.data} writable={context.state === "authenticated"} />;
}
