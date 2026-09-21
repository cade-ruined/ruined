import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MemberInvitation from "@/components/membership/MemberInvitation";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { resolveCurrentPlatformSession } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOwnPersonalInvitations } from "@/lib/membership/personal-invitation-repository";
import { getPersonalInvitationEmailReady } from "@/lib/membership/personal-invitation-delivery";
import { MemberInvitationError } from "@/lib/membership/invitation-model";
import { personalInvitationPreviewSnapshot } from "@/lib/membership/personal-invitation-preview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Invitations", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function MyInvitationPage({ searchParams }: { searchParams?: Promise<{ preview?: string }> }) {
  const configuration = getPlatformConfiguration();
  if (configuration.mode === "preview") return <MemberInvitation initialSnapshot={personalInvitationPreviewSnapshot({ canGrantComplimentary: (await searchParams)?.preview === "admin" })} preview />;
  if (configuration.mode !== "connected") return <PlatformUnavailable accessHref="/my/access" />;
  const session = await resolveCurrentPlatformSession();
  if (session.status === "signed_out") redirect("/my/access");
  if (session.status === "unavailable") return <PlatformUnavailable />;
  try { return <MemberInvitation initialSnapshot={{ ...await getOwnPersonalInvitations(session.viewer.authUserId), emailReady: getPersonalInvitationEmailReady() }} />; }
  catch (error) {
    if (error instanceof MemberInvitationError && error.status === 403) return <PlatformUnavailable reason="member_access" />;
    return <MemberInvitation initialSnapshot={null} />;
  }
}
