import { redirect } from "next/navigation";
import GuidedTimeline from "./GuidedTimeline";
import MemberAccessNotice from "./MemberAccessNotice";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getSupportAccessUrl } from "@/lib/auth/support-return";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_IDENTITY } from "@/lib/membership/preview";
import { getMemberIdentity } from "@/lib/membership/repository";
import { getJournal, getJournalEntry } from "@/lib/membership/journal-repository";
import { JournalError } from "@/lib/membership/journal-model";
import { GUIDED_TIMELINE_PREVIEW } from "@/lib/membership/guided-timeline-preview";

export default async function GuidedTimelinePage({ moment, startNew = false }: { moment?: string; startNew?: boolean }) {
  const accessHref = getSupportAccessUrl(startNew ? "/my/timeline/new" : "/my/timeline");
  const context = await getMembershipPageContext(PREVIEW_MEMBER_IDENTITY, getMemberIdentity, "Timeline");
  if (context.state === "signed_out") redirect(accessHref);
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref={accessHref} />;
  const access = deriveMemberAccessPolicy(context.data);
  if (!memberCan(access, "profile.read")) return <MemberAccessNotice access={access} />;
  const key = startNew ? "new" : moment ?? "timeline";
  if (context.state === "preview") return <GuidedTimeline key={key} initialJournal={GUIDED_TIMELINE_PREVIEW} preview initialEntryId={moment} startNew={startNew} />;
  if (!context.viewer) return <PlatformUnavailable accessHref={accessHref} />;
  try {
    const journal = await getJournal(context.viewer.authUserId, null, false, { view: "timeline", order: "newest" });
    // A deep link can point beyond the first page. Always resolve it through
    // the owner-scoped reader; never substitute another member's entry.
    if (moment && !journal.entries.some(entry => entry.id === moment)) {
      try {
        const entry = await getJournalEntry(context.viewer.authUserId, moment);
        if (entry.includeOnTimeline || entry.timelineReflection) journal.entries = [entry, ...journal.entries];
      } catch (error) {
        if (!(error instanceof JournalError) || error.status !== 404) throw error;
      }
    }
    return <GuidedTimeline key={key} initialJournal={journal} ownerId={context.viewer.authUserId} initialEntryId={moment} startNew={startNew} />;
  } catch (error) {
    console.error("Timeline could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <PlatformUnavailable accessHref={accessHref} />;
  }
}
