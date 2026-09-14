import { redirect } from "next/navigation";

import MemberFoundationsExperience from "@/components/foundations/MemberFoundationsExperience";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { PREVIEW_MEMBER_IDENTITY } from "@/lib/membership/preview";
import { memberPreviewFoundations } from "@/lib/membership/preview-scenarios";
import MemberAccessNotice from "@/components/membership/MemberAccessNotice";
import { getMemberFoundationsState } from "@/lib/foundations/repository";
import { getMemberFoundationRequirements, getMemberIdentity } from "@/lib/membership/repository";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMembershipPageContext } from "@/lib/membership/page-context";

export const dynamic = "force-dynamic";

export default async function MemberFoundationsExperiencePage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_IDENTITY, getMemberIdentity, "Foundations");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const access = deriveMemberAccessPolicy(context.data);
  if (!memberCan(access, "foundations.write")) return <MemberAccessNotice access={access} />;

  if (context.state === "preview") {
    return (
      <MemberFoundationsExperience
        initialState={memberPreviewFoundations(context.data)}
        writable={false}
      />
    );
  }

  if (!context.data || !context.viewer) {
    return <PlatformUnavailable accessHref="/my/access" />;
  }

  let foundations;
  let requirements;
  try {
    [foundations, requirements] = await Promise.all([
      getMemberFoundationsState(context.viewer.authUserId),
      getMemberFoundationRequirements(context.viewer.authUserId),
    ]);
  } catch (error) {
    console.error("Member Foundations experience could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/my/access" />;
  }

  if (!foundations) return <PlatformUnavailable accessHref="/my/access" />;
  if (!foundations.enrollmentId && foundations.status === "not_started") {
    redirect("/my/foundations");
  }
  return (
    <MemberFoundationsExperience
      initialState={{ ...foundations, requirements }}
      writable
    />
  );
}
