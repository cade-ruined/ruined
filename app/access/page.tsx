import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberJourneyShell from "@/components/membership/MemberJourneyShell";
import AccessPage from "@/components/platform/AccessPage";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { completePlatformSignIn, getSupportSignInDestination } from "@/lib/auth/platform-access";
import { getSupportReturnTo } from "@/lib/auth/support-return";
import { resolveCurrentPlatformSession } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { PlatformAccessDeniedError } from "@/lib/platform/repository";
import { sharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Members",
  description: "Sign in to Ruined Membership.",
  alternates: { canonical: "https://members.theruinedproject.com/access" },
  ...sharingMetadata({
    title: "Members",
    description: "Sign in to Ruined Membership.",
    path: "https://members.theruinedproject.com/access",
  }),
};
export const dynamic = "force-dynamic";

export default async function RuinedAccessPage({ searchParams }: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const returnTo = getSupportReturnTo((await searchParams).returnTo);
  const configuration = getPlatformConfiguration();
  const session = configuration.mode === "connected" ? await resolveCurrentPlatformSession() : null;
  let redirectTo: string | null = null;
  let unavailable = session?.status === "unavailable";

  if (session?.status === "authenticated") {
    try {
      const viewer = session.viewer;
      const access = await completePlatformSignIn(viewer);
      redirectTo = await getSupportSignInDestination(viewer, returnTo, access.redirectTo);
    } catch (error) {
      // An authorization denial can offer another sign-in. A failed connection
      // is not evidence that the current identity needs to sign in again.
      unavailable = !(error instanceof PlatformAccessDeniedError);
    }
  }

  if (redirectTo) redirect(redirectTo);

  return <MemberJourneyShell configuration={configuration}>{unavailable ? <PlatformUnavailable /> : <AccessPage enabled={configuration.mode === "connected"} returnTo={returnTo ?? undefined} />}</MemberJourneyShell>;
}
