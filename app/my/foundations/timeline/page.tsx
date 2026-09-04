import type { Metadata } from "next";
import { redirect } from "next/navigation";

import RuinedTimeline from "@/components/membership/RuinedTimeline";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_TIMELINE } from "@/lib/membership/preview";
import { getMemberTimeline } from "@/lib/membership/repository";
import { memberCan } from "@/lib/membership/access-policy";

export const metadata: Metadata = { title: "Ruined Timeline | Foundations" };
export const dynamic = "force-dynamic";

export default async function MyTimelinePage() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_TIMELINE, getMemberTimeline, "Timeline");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  return (
    <RuinedTimeline
      initialTimeline={context.data}
      preview={context.state === "preview"}
      writable={context.state === "authenticated" && memberCan(context.data.access, "foundations.write")}
    />
  );
}
