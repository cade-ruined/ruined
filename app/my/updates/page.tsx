import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberUpdates from "@/components/membership/MemberUpdates";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_UPDATES } from "@/lib/membership/preview";
import { getMemberUpdates } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Updates | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyUpdatesPage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_UPDATES, getMemberUpdates, "updates");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberUpdates initialUpdates={context.data} writable={context.state === "authenticated"} />;
}
