import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MemberCardEditor from "@/components/membership/MemberCardEditor";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { resolveCurrentPlatformSession } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOwnMemberCard } from "@/lib/membership/public-card-repository";
import { memberCardPreviewSnapshot } from "@/lib/membership/public-card-preview";
import { PublicCardError } from "@/lib/membership/public-card-model";

export const metadata: Metadata = { title: "Your member card", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MyMemberCardPage() {
  const configuration = getPlatformConfiguration();
  if (configuration.mode === "preview") return <MemberCardEditor initialSnapshot={memberCardPreviewSnapshot()} writable={false} preview />;
  if (configuration.mode !== "connected") return <PlatformUnavailable accessHref="/my/access" />;
  const session = await resolveCurrentPlatformSession();
  if (session.status === "signed_out") redirect("/my/access");
  if (session.status === "unavailable") return <PlatformUnavailable />;
  try {
    const snapshot = await getOwnMemberCard(session.viewer.authUserId);
    return <MemberCardEditor initialSnapshot={snapshot} writable={snapshot.writable} />;
  } catch (error) {
    if (error instanceof PublicCardError && error.status === 403) return <PlatformUnavailable reason="member_access" />;
    return <MemberCardEditor initialSnapshot={null} writable />;
  }
}
