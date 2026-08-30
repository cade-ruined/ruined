"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  OpsExperienceCalendarState,
  OpsExperienceLifecycleState,
} from "@/lib/platform/ops-experience-model";

const actionButton = "min-h-11 rounded-[4px] bg-black px-4 text-xs font-bold text-white transition hover:bg-[var(--color-poster)] disabled:opacity-40";
const quietButton = "min-h-11 rounded-[4px] bg-black/[0.065] px-4 text-xs font-bold text-black/65 transition hover:bg-black/10 disabled:opacity-40";

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
  switch (calendar.status) {
    case "synced": return "Invitations are current";
    case "pending_create": return "Ready to create";
    case "pending_update": return "Changes need to be sent";
    case "pending_cancel": return "Cancellation needs to be sent";
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
  experienceId,
  experienceState,
  preview = false,
  scope,
}: {
  calendar: OpsExperienceCalendarState;
  canManage: boolean;
  experienceId: string;
  experienceState: OpsExperienceLifecycleState;
  preview?: boolean;
  scope: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

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
  const assignedCopy = calendar.attendeeCount === 1
    ? "1 person will receive the invitation"
    : `${calendar.attendeeCount} people will receive the invitation`;

  return (
    <section aria-busy={pending} className="rounded-[4px] bg-[#d9d6cf] px-5 py-5" aria-labelledby="experience-calendar-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="[font-family:var(--font-cadehandy2)] text-2xl text-[var(--color-poster)]">Invite</p>
          <h2 className="font-[var(--font-display)] text-3xl" id="experience-calendar-title">Google Calendar</h2>
        </div>
        <span className="whitespace-nowrap rounded-full bg-black px-3 py-1 text-[0.58rem] font-bold uppercase tracking-[0.06em] text-white">
          {statusCopy(calendar)}
        </span>
      </div>

      <p className="mt-4 text-sm font-semibold text-black/75">{scope}</p>
      <p className="mt-1 text-sm text-black/52">{assignedCopy}. Waitlisted and cancelled places are excluded.</p>

      {calendar.organizerEmail ? (
        <p className="mt-4 text-xs text-black/45">From {calendar.organizerEmail}</p>
      ) : null}
      {lastSynced ? <p className="mt-1 text-xs text-black/45">Last sent {lastSynced}</p> : null}
      {calendar.lastError ? <p className="mt-3 text-sm text-[var(--color-poster)]">{calendar.lastError}</p> : null}

      {!calendar.configured ? (
        <p className="mt-4 rounded-[4px] bg-white/55 px-4 py-3 text-sm text-black/62">
          Connect the Ruined Workspace organizer to begin sending invitations.
        </p>
      ) : experienceState === "draft" ? (
        <p className="mt-4 rounded-[4px] bg-white/55 px-4 py-3 text-sm text-black/62">
          Publishing creates the calendar event, adds a private Google Meet, and sends it to this audience.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {experienceState === "published" && calendar.status !== "cancelled" ? (
          <button
            className={actionButton}
            disabled={!canSend || pending}
            onClick={() => sync(intentFor(calendar))}
            type="button"
          >
            {pending ? "Sending" : calendar.googleEventId ? "Sync invitations" : "Create invite + Meet"}
          </button>
        ) : null}
        {calendar.googleEventUrl && calendar.status !== "cancelled" ? (
          <a className={quietButton} href={calendar.googleEventUrl} rel="noreferrer" target="_blank">Open calendar</a>
        ) : null}
        {experienceState === "cancelled" && calendar.googleEventId && calendar.status !== "cancelled" ? (
          <button className={actionButton} disabled={!canManage || !calendar.configured || pending} onClick={() => sync("cancel")} type="button">
            {pending ? "Sending" : "Send cancellation"}
          </button>
        ) : null}
      </div>
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
