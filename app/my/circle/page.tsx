import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberCircleRoom from "@/components/membership/MemberCircleRoom";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_CIRCLE } from "@/lib/membership/preview";
import { getMemberCircle } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Circle | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyCirclePage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_CIRCLE, getMemberCircle, "Circle");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberCircleRoom circle={context.data} />;
}
