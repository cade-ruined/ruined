import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberHome from "@/components/platform/MemberHome";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { withFreshApplicationDatabaseRead } from "@/lib/database/server";
import type { MemberWelcomeSnapshot } from "@/lib/membership/welcome-model";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_HOME } from "@/lib/membership/preview";
import { getMemberProfileHome } from "@/lib/membership/repository";
import type { MemberProfileHomeSnapshot } from "@/lib/membership/model";

export const metadata: Metadata = {
  title: "Your Profile | Ruined",
  description: "Your private Ruined member profile, Circle, artifacts, and experiences.",
};
export const dynamic = "force-dynamic";

export default async function MyRuinedPage() {
  const context = await getMembershipPageContext<MemberProfileHomeSnapshot>(
    PREVIEW_MEMBER_HOME,
    (authUserId) => withFreshApplicationDatabaseRead("member-home", () => getMemberProfileHome(authUserId)),
    "home",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (context.state === "unavailable" && context.viewer) {
    return <section className="grid min-h-[55vh] content-center py-16 text-[var(--member-ink)]">
      <h1 className="font-[var(--font-display)] text-[clamp(2.5rem,6vw,5rem)] leading-none">Your profile couldn’t load.</h1>
      <p className="mt-6 text-base">Please try again.</p>
      <a className="member-button mt-8 w-fit" href="">Reload profile</a>
    </section>;
  }
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;

  // Live getting-started progress loads independently in MemberWelcome. It must
  // never delay the profile, badges, or private Journal.
  const welcome: MemberWelcomeSnapshot | null = context.state === "preview" ? {
    ownerId: context.data.identity.authUserId, dismissedAt: null, calendarViewedAt: null, hasJournalEntry: false,
    hasUpcomingCall: (context.data as typeof PREVIEW_MEMBER_HOME).upcomingExperiences.some(event => Boolean(event.meetingUrl)
      && event.registrationState === "registered" && Date.parse(event.startsAt) > Date.now()),
  } : null;
  return <MemberHome member={context.data} preview={context.state === "preview"} welcome={welcome} loadedAt={Date.now()} />;
}
