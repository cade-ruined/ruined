import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import {
  OperatorAnnouncementCreateAction,
  OperatorAnnouncementPublishAction,
} from "@/components/platform/OperatorWorkActions";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsAnnouncementAudienceOptions, OpsAnnouncementSummary } from "@/lib/platform/ops-model";

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

export default function OperatorAnnouncements({
  announcements,
  audienceOptions,
  canManage,
}: {
  announcements: OpsAnnouncementSummary[];
  audienceOptions: OpsAnnouncementAudienceOptions;
  canManage: boolean;
}) {
  return (
    <OperatorPageFrame title="Announcements">
      <section className="space-y-3" aria-label="Recent announcements">
        {announcements.map((announcement) => (
          <article
            className="grid gap-6 rounded-[4px] bg-black/[0.025] px-5 py-6 transition-colors hover:bg-black/[0.055] sm:px-6 lg:grid-cols-[minmax(15rem,1fr)_10rem_minmax(12rem,0.55fr)] lg:items-start"
            key={announcement.announcementId}
          >
            <div>
              <h2 className="text-3xl leading-none tracking-[-0.025em]">{announcement.title}</h2>
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-black/55">{announcement.body}</p>
            </div>
            <div>
              <StateLabel state={announcement.state} />
              <p className="mt-3 text-xs text-black/42">{formatDate(announcement.publishedAt)}</p>
            </div>
            <div>
              <p className="text-sm text-black/45">Audience</p>
              <p className="mt-2 text-sm text-black/62">{announcement.targetLabel}</p>
              {canManage && announcement.state === "draft" ? (
                <div className="mt-5"><OperatorAnnouncementPublishAction announcementId={announcement.announcementId} /></div>
              ) : null}
            </div>
          </article>
        ))}
        {announcements.length === 0 ? (
          <OperatorEmptyState
            actionHref={canManage ? "#new-announcement" : "/ops"}
            actionLabel={canManage ? "Write announcement" : "Return to overview"}
            detail="Announcements become part of the member record once they are published. Draft first, then review the audience before sending."
            eyebrow="Nothing published"
            title="The announcement board is quiet."
          />
        ) : null}
      </section>

      {canManage ? (
        <details
          className={`group mt-8 rounded-[4px] bg-black/[0.025] ${announcements.length === 0 ? "shadow-[5px_5px_0_var(--color-poster)]" : ""}`}
          id="new-announcement"
          open={announcements.length === 0}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 px-5 py-5 transition-colors hover:bg-black/[0.04] sm:px-6 [&::-webkit-details-marker]:hidden">
            <span className="font-[var(--font-display)] text-2xl leading-none tracking-[-0.02em]">
              New announcement
            </span>
            <span
              aria-hidden="true"
              className="text-2xl leading-none transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="px-5 pb-5 sm:px-6 [&>form]:border-0 [&>form]:py-0">
            <OperatorAnnouncementCreateAction audienceOptions={audienceOptions} />
          </div>
        </details>
      ) : null}
    </OperatorPageFrame>
  );
}
