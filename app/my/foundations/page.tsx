import { redirect } from "next/navigation";

import MemberFoundationsHome from "@/components/foundations/MemberFoundationsHome";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { PREVIEW_MEMBER_FOUNDATIONS_STATE } from "@/lib/foundations/model";
import { getMemberFoundationsState } from "@/lib/foundations/repository";
import { getMemberFoundationRequirements } from "@/lib/membership/repository";
import { hasActiveMemberAccess } from "@/lib/platform/model";
import { getMemberPageContext } from "@/lib/platform/page-data";

export const dynamic = "force-dynamic";

export default async function MyFoundationsPage() {
  const context = await getMemberPageContext();
  if (context.state === "signed_out") redirect("/my/access");
  if (
    context.state !== "preview" &&
    context.member &&
    !hasActiveMemberAccess(context.member)
  ) {
    redirect("/my/account");
  }

  if (context.state === "preview") {
    return (
      <MemberFoundationsHome
        initialState={PREVIEW_MEMBER_FOUNDATIONS_STATE}
        writable={false}
      />
    );
  }

  if (!context.member || !context.viewer) {
    return <PlatformUnavailable accessHref="/my/access" />;
  }

  try {
    const [foundations, requirements] = await Promise.all([
      getMemberFoundationsState(context.viewer.authUserId),
      getMemberFoundationRequirements(context.viewer.authUserId),
    ]);
    return foundations ? (
      <MemberFoundationsHome initialState={{ ...foundations, requirements }} writable />
    ) : (
      <PlatformUnavailable accessHref="/my/access" />
    );
  } catch (error) {
    console.error("Member Foundations could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/my/access" />;
  }
}
