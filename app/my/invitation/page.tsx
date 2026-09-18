import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MemberInvitation from "@/components/membership/MemberInvitation";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOwnMemberInvitation } from "@/lib/membership/invitation-repository";
import { MemberInvitationError } from "@/lib/membership/invitation-model";
import { memberInvitationPreviewSnapshot } from "@/lib/membership/invitation-preview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function MyInvitationPage() {
  const configuration = getPlatformConfiguration();
  if (configuration.mode === "preview") return <MemberInvitation initialSnapshot={memberInvitationPreviewSnapshot()} preview />;
  if (configuration.mode !== "connected") return <PlatformUnavailable accessHref="/my/access" />;
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) redirect("/my/access");
  try { return <MemberInvitation initialSnapshot={await getOwnMemberInvitation(viewer.authUserId)} />; }
  catch (error) {
    if (error instanceof MemberInvitationError && error.status === 403) return <PlatformUnavailable reason="member_access" />;
    return <MemberInvitation initialSnapshot={null} />;
  }
}
