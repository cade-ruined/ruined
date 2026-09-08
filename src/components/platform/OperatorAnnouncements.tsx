"use client";

import { useState } from "react";
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
  preview = false,
}: {
  announcements: OpsAnnouncementSummary[];
  audienceOptions: OpsAnnouncementAudienceOptions;
  canManage: boolean;
  preview?: boolean;
}) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  return (
    <OperatorPageFrame title="Announcements">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-black/60">Save a draft, review its audience, then publish to the member app.</p>
        {canManage ? <a className="ui-heading inline-flex min-h-11 items-center rounded-[4px] bg-[var(--color-faded)] px-4 text-sm font-semibold text-[var(--color-bone)]" href="#new-announcement">Write announcement</a> : null}
      </header>
      {preview ? <p className="mb-4 text-sm text-black/60" role="status">Preview — drafts are not saved and announcements are not published.</p> : null}
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
                <div className="mt-4">
                  {reviewingId === announcement.announcementId ? (
                    <div className="rounded-[4px] bg-[var(--color-highlight)]/30 p-3" role="group" aria-label={`Review publishing ${announcement.title}`}>
                      <p className="mb-3 text-sm leading-relaxed">Publish to <strong>{announcement.targetLabel}</strong>? Members will see this exact draft. Published announcements cannot be edited or retracted here.</p>
                      <OperatorAnnouncementPublishAction announcementId={announcement.announcementId} preview={preview} />
                      <button className="mt-2 min-h-11 text-sm underline underline-offset-4" onClick={() => setReviewingId(null)} type="button">Cancel review</button>
                    </div>
                  ) : <button className="min-h-11 text-sm font-semibold underline underline-offset-4" onClick={() => setReviewingId(announcement.announcementId)} type="button">Review & publish</button>}
                </div>
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
        <section
          className="mt-8 scroll-mt-32 rounded-[4px] bg-black/[0.025] p-5 sm:p-6"
          aria-label="Write announcement draft"
          id="new-announcement"
        >
          <div className="[&>form]:border-0 [&>form]:py-0">
            <OperatorAnnouncementCreateAction audienceOptions={audienceOptions} preview={preview} />
          </div>
        </section>
      ) : null}
    </OperatorPageFrame>
  );
}
