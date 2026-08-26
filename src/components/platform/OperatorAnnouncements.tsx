import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import {
  OperatorAnnouncementCreateAction,
  OperatorAnnouncementPublishAction,
} from "@/components/platform/OperatorWorkActions";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsAnnouncementSummary } from "@/lib/platform/ops-model";

function formatDate(value: string | null): string {
  if (!value) return "Not published";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not published";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function OperatorAnnouncements({ announcements, canManage }: { announcements: OpsAnnouncementSummary[]; canManage: boolean }) {
  return (
    <OperatorPageFrame
      eyebrow="Announcements"
      introduction="Member-facing updates begin as drafts, name their audience, and publish as an auditable record. Delivery remains a separate workflow."
      title="Announcements"
    >
      {canManage ? <div className="mt-14"><OperatorAnnouncementCreateAction /></div> : null}

      <section className="mt-14 border-t border-black/25" aria-label="Announcement history">
        {announcements.map((announcement) => (
          <article className="grid gap-6 border-b border-black/15 py-7 lg:grid-cols-[minmax(15rem,1fr)_10rem_minmax(12rem,0.55fr)] lg:items-start" key={announcement.announcementId}>
            <div>
              <h2 className="text-3xl leading-none tracking-[-0.025em]">{announcement.title}</h2>
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-black/55">{announcement.body}</p>
            </div>
            <div>
              <StateLabel state={announcement.state} />
              <p className="mt-3 text-xs text-black/42">{formatDate(announcement.publishedAt)}</p>
            </div>
            <div>
              <p className="text-[0.6rem] font-medium uppercase tracking-[0.15em] text-black/38">Audience</p>
              <p className="mt-3 text-sm text-black/62">{announcement.targetLabel}</p>
              {canManage && announcement.state === "draft" ? (
                <div className="mt-5"><OperatorAnnouncementPublishAction announcementId={announcement.announcementId} /></div>
              ) : null}
            </div>
          </article>
        ))}
        {announcements.length === 0 ? (
          <p className="border-b border-black/15 py-10 text-sm text-black/50">No announcements have been recorded.</p>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
