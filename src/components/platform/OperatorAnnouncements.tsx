"use client";

import { useEffect, useState } from "react";
import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorMessagesTabs from "@/components/platform/OperatorMessagesTabs";
import OperatorDialog from "@/components/platform/OperatorDialog";
import { OPERATOR_FIELD_CLASS, OPERATOR_LABEL_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";
import {
  OperatorAnnouncementCreateAction,
  OperatorAnnouncementCloseAction,
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    function readLocation() { if (canManage && window.location.hash === "#new-announcement") setComposing(true); }
    readLocation();
    window.addEventListener("hashchange", readLocation);
    return () => window.removeEventListener("hashchange", readLocation);
  }, [canManage]);
  function closeComposer() {
    setComposing(false);
    window.history.replaceState(window.history.state, "", "#announcements");
  }
  const visible = announcements.filter((item) =>
    item.announcementId === editingId || (
      (showHistory || !["archived", "cancelled"].includes(item.state))
      && `${item.title} ${item.body} ${item.targetLabel}`.toLowerCase().includes(query.trim().toLowerCase())
    ),
  );
  return (
    <OperatorPageFrame title="Messages">
      <OperatorMessagesTabs active="posts" />
      <header className="operator-record-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="operator-page-heading">Board posts</h2><p className="mt-1 text-xs text-black/60">Visible in the app. No email or text is sent.</p></div>
        {canManage ? <button className={OPERATOR_PRIMARY_ACTION_CLASS} id="open-new-announcement" onClick={() => { setComposing(true); setNotice(""); window.history.replaceState(window.history.state, "", "#new-announcement"); }} type="button">Write announcement</button> : null}
      </header>
      {preview ? <p className="mb-4 text-sm text-black/60" role="status">Preview — drafts are not saved and announcements are not published.</p> : null}
      {notice ? <p role="status" className="mb-4 text-sm">{notice}</p> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className={OPERATOR_LABEL_CLASS}><span className="operator-compact-label">Find a post</span><input className={OPERATOR_FIELD_CLASS} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, message, or audience" type="search" value={query} /></label>
        <label className="flex min-h-12 items-center gap-2 text-sm text-black/60"><input checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} type="checkbox" />Include discarded and retracted</label>
      </div>
      <section className="space-y-3" aria-label="Recent announcements" id="announcements">
        {visible.map((announcement) => (
          <article
            className="operator-bento-card grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.4fr)] lg:items-start"
            key={announcement.announcementId}
          >
            <div>
              <h3 className="break-words text-base font-semibold leading-snug">{announcement.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/55">
                {announcement.state === "archived" ? <span>Retracted</span> : announcement.state === "cancelled" ? <span>Discarded</span> : <StateLabel state={announcement.state} />}
                <span>{formatDate(announcement.publishedAt)}</span><span>{announcement.targetLabel}</span>
              </div>
              <p className="mt-3 max-w-3xl whitespace-pre-wrap break-words text-sm leading-relaxed text-black/65">{announcement.body}</p>
            </div>
            <div>
              {canManage && announcement.state === "draft" && editingId !== announcement.announcementId ? (
                <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                  {reviewingId === `${announcement.announcementId}:${announcement.version}` ? (
                    <div className="rounded-[4px] bg-[var(--color-highlight)]/30 p-3" role="group" aria-label={`Review publishing ${announcement.title}`}>
                      <p className="mb-3 text-sm leading-relaxed">Publish to <strong>{announcement.targetLabel}</strong>? Members will see this exact draft. You can retract it later.</p>
                      <OperatorAnnouncementPublishAction announcementId={announcement.announcementId} expectedVersion={announcement.version} preview={preview} />
                      <button className="mt-2 min-h-11 text-sm underline underline-offset-4" onClick={() => setReviewingId(null)} type="button">Cancel review</button>
                    </div>
                  ) : <button className="min-h-11 text-sm font-semibold underline underline-offset-4" onClick={() => setReviewingId(`${announcement.announcementId}:${announcement.version}`)} type="button">Review & publish</button>}
                  <button className="min-h-11 text-sm underline underline-offset-4" onClick={() => { setEditingId(announcement.announcementId); setReviewingId(null); }} type="button">Edit draft</button>
                </div>
              ) : null}
              {canManage && ["draft", "published"].includes(announcement.state) && editingId !== announcement.announcementId ? <OperatorAnnouncementCloseAction key={`${announcement.announcementId}:${announcement.version}`} announcement={announcement} preview={preview} /> : null}
            </div>
            {canManage && editingId === announcement.announcementId && announcement.state === "draft" ? <div className="lg:col-span-2"><OperatorAnnouncementCreateAction key={`${announcement.announcementId}:${announcement.version}`} announcement={announcement} audienceOptions={audienceOptions} onSaved={() => setEditingId(null)} onCancel={() => setEditingId(null)} preview={preview} /></div> : null}
          </article>
        ))}
        {visible.length === 0 ? (
          <OperatorEmptyState
            actionHref={canManage ? undefined : "/ops"}
            actionLabel={canManage ? undefined : "Return to overview"}
            detail={announcements.length ? "Try another search or include discarded and retracted posts." : "Choose Write announcement to save a draft, then review before publishing to the member app."}
            eyebrow="Nothing published"
            title={announcements.length ? "No matching posts." : "The announcement board is quiet."}
          />
        ) : null}
      </section>

      {canManage && composing ? <OperatorDialog open title="Write announcement" onClose={closeComposer} returnFocusId="open-new-announcement">
        <section
          aria-label="Write announcement draft"
          id="new-announcement"
        >
          <p className="mb-5 text-sm text-black/60">Save a draft first. Nothing appears for members until you review and publish it.</p>
          <OperatorAnnouncementCreateAction audienceOptions={audienceOptions} compact onSaved={() => { closeComposer(); setNotice("Draft created. Review it before publishing."); }} preview={preview} />
        </section>
      </OperatorDialog> : null}
    </OperatorPageFrame>
  );
}
