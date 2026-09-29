import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import MemberCirclePreferences from "@/components/platform/MemberCirclePreferences";
import MemberCircleRoom from "@/components/membership/MemberCircleRoom";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { memberCan } from "@/lib/membership/access-policy";
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
  if (context.data.revealStatus === "locked" && memberCan(context.data.access, "foundations.write")) {
    return (
      <main className="member-journey-page">
        <header className="member-page-heading">
          <p className="member-eyebrow">Your people</p>
          <h1 className="member-page-title">A Circle is taking shape.</h1>
          <p>Your Circle will be revealed at the final moment of Foundations. Tell us what works for you while the team prepares your placement.</p>
          <Link className="member-button member-button-primary" href="/my/foundations">Continue Foundations →</Link>
        </header>
        <MemberCirclePreferences preview={context.state === "preview"} />
      </main>
    );
  }
  return <MemberCircleRoom circle={context.data} />;
}
