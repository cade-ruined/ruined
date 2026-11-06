import { redirect } from "next/navigation";
import GuidedTimeline, { type PracticeComposerDraft } from "./GuidedTimeline";
import { getPracticeTimelineResume } from "@/lib/practice/timeline-draft-handoff";
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

export default async function GuidedTimelinePage({ moment, startNew = false, practice = false, resumePracticeDraft = false }: { moment?: string; startNew?: boolean; practice?: boolean; resumePracticeDraft?: boolean }) {
  const query = new URLSearchParams();
  if (moment) query.set("moment", moment);
  if (practice) query.set("practice", "f1");
  if (resumePracticeDraft) query.set("resume", "1");
  const accessHref = getSupportAccessUrl(`${startNew ? "/my/timeline/new" : "/my/timeline"}${query.size ? `?${query}` : ""}`);
  const context = await getMembershipPageContext(PREVIEW_MEMBER_IDENTITY, getMemberIdentity, "Timeline");
  if (context.state === "signed_out") redirect(accessHref);
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref={accessHref} />;
  const access = deriveMemberAccessPolicy(context.data);
  if (!memberCan(access, "profile.read")) return <MemberAccessNotice access={access} />;
  const key = `${practice ? "f1-" : ""}${startNew ? "new" : moment ?? "timeline"}`;
  if (context.state === "preview") return <GuidedTimeline key={key} initialJournal={GUIDED_TIMELINE_PREVIEW} preview initialEntryId={moment} startNew={startNew} practice={practice} />;
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
    let initialWorkDraft: PracticeComposerDraft | undefined;
    let initialEntryId = moment;
    let openNew = startNew;
    if (practice && resumePracticeDraft) {
      const resume = await getPracticeTimelineResume(context.viewer.authUserId);
      if (resume) {
        initialWorkDraft = { draft: resume.draft, revision: resume.revision, entryId: resume.entryId, newerSavedVersion: Boolean(resume.savedEntry) };
        const entry = resume.savedEntry ?? resume.sourceEntry;
        if (entry) {
          journal.entries = [entry, ...journal.entries.filter(item => item.id !== entry.id)];
          initialEntryId = entry.id; openNew = false;
        } else { initialEntryId = undefined; openNew = true; }
      }
    }
    return <GuidedTimeline key={key} initialJournal={journal} ownerId={context.viewer.authUserId} initialEntryId={initialEntryId} startNew={openNew} practice={practice} initialWorkDraft={initialWorkDraft} />;
  } catch (error) {
    console.error("Timeline could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <PlatformUnavailable accessHref={accessHref} />;
  }
}
