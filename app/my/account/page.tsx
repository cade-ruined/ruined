import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberAccount from "@/components/membership/MemberAccount";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_ACCOUNT } from "@/lib/membership/preview";
import { getMemberAccount } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Account | Ruined Membership" };
export const dynamic = "force-dynamic";

export default async function MyAccountPage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_ACCOUNT, getMemberAccount, "account");
  if (context.state === "signed_out") redirect("/my/access");
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return <MemberAccount account={context.data} billingConnected={context.configuration.stripe === "connected" && context.state === "authenticated"} />;
}
