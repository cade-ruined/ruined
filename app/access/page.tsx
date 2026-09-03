import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AccessPage from "@/components/platform/AccessPage";
import { completePlatformSignIn, getSupportSignInDestination } from "@/lib/auth/platform-access";
import { getSupportReturnTo } from "@/lib/auth/support-return";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Access Ruined",
};
export const dynamic = "force-dynamic";

export default async function RuinedAccessPage({ searchParams }: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const returnTo = getSupportReturnTo((await searchParams).returnTo);
  const configuration = getPlatformConfiguration();
  const viewer = configuration.mode === "connected" ? await getCurrentPlatformViewer() : null;
  let redirectTo: string | null = null;

  if (viewer) {
    try {
      const access = await completePlatformSignIn(viewer);
      redirectTo = await getSupportSignInDestination(viewer, returnTo, access.redirectTo);
    } catch {
      // An incomplete or revoked account returns to the same neutral access form.
    }
  }

  if (redirectTo) redirect(redirectTo);

  return <AccessPage enabled={configuration.mode === "connected"} returnTo={returnTo ?? undefined} />;
}
