"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import OperatorDialog from "@/components/platform/OperatorDialog";

import type {
  OpsExperienceCalendarState,
  OpsExperienceLifecycleState,
} from "@/lib/platform/ops-experience-model";

const actionButton = "inline-flex min-h-11 items-center justify-center rounded-[8px] bg-[var(--color-faded)] px-4 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-40";
const quietButton = "inline-flex min-h-11 items-center justify-center rounded-[8px] bg-black/[0.065] px-4 text-sm font-medium text-black/65 transition hover:bg-black/10 disabled:opacity-40";

function formatDate(value: string | null) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return null;
  }
}

function statusCopy(calendar: OpsExperienceCalendarState) {
  if (calendar.bindingRequired) return "Verify delivery mode";
  if (calendar.automaticDeliveryPaused) return "Review past event";
  switch (calendar.status) {
    case "synced": return "Invitations are current";
    case "pending_create": return "Invitation queued";
    case "pending_update": return "Update queued";
    case "pending_cancel": return "Cancellation queued";
    case "failed": return "Needs attention";
    case "cancelled": return "Calendar event cancelled";
    default: return "Not sent";
  }
}

function intentFor(calendar: OpsExperienceCalendarState) {
  return calendar.googleEventId ? "sync" : "create";
}

export default function OperatorExperienceCalendar({
  calendar,
  canManage,
  canBind = false,
  experienceId,
  experienceState,
  preview = false,
  scope,
  meetingUrl,
  linksEnabled = true,
  audienceReviewHref,
  audienceReviewLabel = "Review people",
  children,
}: {
  calendar: OpsExperienceCalendarState;
  canManage: boolean;
  canBind?: boolean;
  experienceId: string;
  experienceState: OpsExperienceLifecycleState;
  preview?: boolean;
  scope: string;
  meetingUrl?: string | null;
  linksEnabled?: boolean;
  audienceReviewHref?: string;
  audienceReviewLabel?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  async function verifyBinding() {
    if (pending || !canBind || !calendar.bindingMode) return;
    if (preview) { setMessage("Preview only — nothing was bound or sent."); return; }
    if (!window.confirm(`Verify this existing Google invitation and bind it to ${calendar.bindingMode.toUpperCase()}? This only reads Google. Use Update invitations afterward to send changes.`)) return;
    setPending(true); setMessage(null); setMessageIsError(false);
    try {
      const response = await fetch(`/api/ops/experiences/${experienceId}/calendar/binding`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ livemode: calendar.bindingMode === "live" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Calendar verification failed.");
      setMessage(`Verified. Nothing was sent. Use ${calendar.canSendCancellation ? "Send cancellation" : "Retry invitations in Manage meeting"} to send the pending changes.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calendar verification failed."); setMessageIsError(true);
    } finally { setPending(false); }
  }

  async function sync(intent: "cancel" | "create" | "sync") {
    if (pending) return;
    if (preview) {
      setMessage("Preview only — no invitations were sent.");
      setMessageIsError(false);
      return;
    }
    setPending(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      const response = await fetch(`/api/ops/experiences/${experienceId}/calendar`, {
        body: JSON.stringify({ intent }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        method: "POST",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Calendar invitations could not be sent.");
      setMessage(intent === "cancel" ? "Cancellation sent." : "Calendar invitations sent.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calendar invitations could not be sent.");
      setMessageIsError(true);
    } finally {
      setPending(false);
    }
  }

  const lastSynced = formatDate(calendar.lastSyncedAt);
  const canSend = canManage && calendar.configured && experienceState === "published";
  const isQueued = ["pending_create", "pending_update", "pending_cancel"].includes(calendar.status);
  const joinUrl = calendar.meetingUrl ?? meetingUrl;
  const assignedCopy = calendar.attendeeCount === 1 ? "1 eligible recipient" : `${calendar.attendeeCount} eligible recipients`;

  return (
    <section id="experience-calendar" aria-busy={pending} className="operator-bento-card h-full scroll-mt-28" aria-labelledby="experience-calendar-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="operator-section-heading" id="experience-calendar-title">Meeting</h2>
          <p className="mt-1 text-xs text-black/55">{assignedCopy}</p>
        </div>
        <span className="text-xs font-medium text-black/65">
          {statusCopy(calendar)}
        </span>
      </div>

      {calendar.lastError ? <p className="mt-3 text-sm text-[var(--color-poster)]">{calendar.lastError}</p> : null}

      {calendar.attendeeCount === 0 && ["draft", "published"].includes(experienceState) ? <div className="mt-3 text-sm text-black/65">
        <p>No one is currently eligible for an invitation. Check the audience and member access before sending.</p>
        {audienceReviewHref ? <a className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" href={audienceReviewHref}>{audienceReviewLabel}</a> : null}
      </div> : null}

      {!calendar.configured && !calendar.bindingRequired ? (
        <p className="mt-3 text-sm text-black/62">
          Google Calendar setup needs attention before invitations can be sent.
        </p>
      ) : experienceState === "draft" ? (
        <p className="mt-3 text-sm text-black/62">
          Review & publish to make this Experience available. Google creates the Meet link when its invitation is processed; publishing alone does not confirm delivery.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {linksEnabled && joinUrl && !["cancelled", "archived"].includes(experienceState) && calendar.status !== "cancelled" ? <a className="inline-flex min-h-11 items-center rounded-[4px] bg-[var(--color-faded)] px-4 text-sm font-semibold text-[var(--color-bone)]" href={joinUrl} rel="noreferrer" target="_blank">Open Google Meet ↗</a> : null}
        <button className={quietButton} id="meeting-options-trigger" onClick={() => setOptionsOpen(true)} type="button">{canManage ? "Manage meeting" : "Meeting details"}</button>
        {isQueued ? <button className={quietButton} type="button" disabled={pending} onClick={() => router.refresh()}>Refresh status</button> : null}
      </div>
      <OperatorDialog open={optionsOpen} title="Manage meeting" pending={pending} returnFocusId="meeting-options-trigger" onClose={() => setOptionsOpen(false)}>
        <div className="space-y-3 pb-2" data-operator-pending={pending ? "true" : "false"}>
          <p className="text-sm font-medium">{scope} · {assignedCopy}</p>
          <p className="text-xs text-black/60">{statusCopy(calendar)}</p>
          {calendar.lastError ? <p className="text-sm text-[var(--color-poster)]">{calendar.lastError}</p> : null}
          {calendar.attendeeCount === 0 ? <p className="text-sm text-[var(--color-poster)]">No one is currently eligible for an invitation. Check the audience before sending.</p> : null}
        <div className="flex flex-wrap gap-2">
        {calendar.bindingRequired && canBind && calendar.bindingMode ? (
          <button className={actionButton} disabled={pending} onClick={verifyBinding} type="button">
            {pending ? "Verifying" : `Verify & bind to ${calendar.bindingMode}`}
          </button>
        ) : null}
        {experienceState === "published" && calendar.status !== "cancelled" && (!isQueued || calendar.automaticDeliveryPaused) ? (
          <button
            className={actionButton}
            disabled={!canSend || pending}
            onClick={() => sync(intentFor(calendar))}
            type="button"
          >
            {pending ? "Sending" : calendar.googleEventId ? "Update invitations" : "Send invitations"}
          </button>
        ) : null}
        {calendar.googleEventUrl && calendar.status !== "cancelled" ? (
          <a className={quietButton} href={calendar.googleEventUrl} rel="noreferrer" target="_blank">Open calendar</a>
        ) : null}
        {(experienceState === "cancelled" || calendar.canSendCancellation) && calendar.googleEventId && calendar.status !== "cancelled" ? (
          <button className={actionButton} disabled={!canManage || !calendar.configured || pending} onClick={() => sync("cancel")} type="button">
            {pending ? "Sending" : "Send cancellation"}
          </button>
        ) : null}
        </div>
        <div className="space-y-3 pt-2">
          {children}
          {experienceState === "published" && isQueued && !calendar.automaticDeliveryPaused ? <button className={quietButton} disabled={!canSend || pending} onClick={() => sync(intentFor(calendar))} type="button">{pending ? "Sending" : "Retry invitations"}</button> : null}
          <p className="text-xs leading-relaxed text-black/50">Google Calendar invites eligible people in the selected audience. Waitlisted and cancelled places are excluded.</p>
          {calendar.organizerEmail ? <p className="text-xs text-black/50">Organizer: {calendar.organizerEmail}</p> : null}
          {lastSynced ? <p className="text-xs text-black/50">Last sent {lastSynced}</p> : null}
        </div>
          {message ? <p className={`text-sm ${messageIsError ? "text-[var(--color-poster)]" : "text-black/65"}`} role={messageIsError ? "alert" : "status"}>{message}</p> : null}
        </div>
      </OperatorDialog>
      {message ? (
        <p
          aria-live={messageIsError ? "assertive" : "polite"}
          className={`mt-3 text-sm ${messageIsError ? "text-[var(--color-poster)]" : "text-black/65"}`}
          role={messageIsError ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
