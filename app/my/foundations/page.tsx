import { redirect } from "next/navigation";

import MemberFoundationsHome from "@/components/foundations/MemberFoundationsHome";
import MemberFoundationsPreview from "@/components/foundations/MemberFoundationsPreview";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { PREVIEW_MEMBER_IDENTITY } from "@/lib/membership/preview";
import MemberAccessNotice from "@/components/membership/MemberAccessNotice";
import { isFoundationsAvailableToMember } from "@/lib/foundations/availability";
import { getMemberIdentity } from "@/lib/membership/repository";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMembershipPageContext } from "@/lib/membership/page-context";

export const dynamic = "force-dynamic";

export default async function MyFoundationsPage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_IDENTITY, getMemberIdentity, "Foundations");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  if (!await isFoundationsAvailableToMember(context.state === "authenticated" ? context.viewer?.authUserId : null)) return <MemberFoundationsPreview />;
  const access = deriveMemberAccessPolicy(context.data);
  if (!memberCan(access, "foundations.write")) return <MemberAccessNotice access={access} />;

  if (context.state === "authenticated" && !context.viewer) {
    return <PlatformUnavailable accessHref="/my/access" />;
  }

  return <MemberFoundationsHome />;
}
