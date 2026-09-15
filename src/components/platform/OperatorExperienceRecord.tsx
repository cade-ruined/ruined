"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import OperatorExperienceCalendar from "@/components/platform/OperatorExperienceCalendar";
import OperatorDialog from "@/components/platform/OperatorDialog";
import OperatorGoogleCommunicationField from "@/components/platform/OperatorGoogleCommunicationField";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";
import {
  zonedDateTimeLocalToIso,
  zonedDateTimeLocalValue,
} from "@/lib/datetime/zoned-date-time";
import type {
  OpsExperienceDirectory,
  OpsExperienceRecord as ExperienceRecord,
  OpsExperienceRosterItem,
} from "@/lib/platform/ops-experience-model";

const quietButton = "min-h-11 rounded-[4px] bg-black/[0.06] px-4 text-xs font-bold text-black/65 transition hover:bg-black/10 disabled:opacity-40";

function FormField({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={`${OPERATOR_LABEL_CLASS} ${className}`}>
      <span className={OPERATOR_LABEL_TEXT_CLASS}>{label}</span>
      {children}
    </label>
  );
}

function formatDate(value: string | null, timezone = "America/Denver") {
  if (!value) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

async function jsonRequest(url: string, body: unknown, method = "POST") {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "The change could not be saved.");
  return payload;
}

function RosterRow({
  canManageAttendance,
  canManageRoster,
  experienceId,
  item,
  onChanged,
  preview,
}: {
  canManageAttendance: boolean;
  canManageRoster: boolean;
  experienceId: string;
  item: OpsExperienceRosterItem;
  onChanged: (calendarChanged?: boolean) => Promise<void>;
  preview: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [attendanceChoice, setAttendanceChoice] = useState(
    ["attended", "checked_in", "no_show"].includes(item.attendanceState ?? "")
      ? item.attendanceState ?? "checked_in"
      : "revoked",
  );

  async function roster(action: "cancel" | "promote" | "waitlist") {
    if (pending) return;
    if (preview) {
      setError("Preview only — the roster was not changed.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await jsonRequest(`/api/ops/experiences/${experienceId}/registrations`, {
        action,
        reason,
        registrationId: item.registrationId,
      });
      setReason("");
      await onChanged(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The roster could not be changed.");
    } finally {
      setPending(false);
    }
  }

  async function attendance(eventType: string) {
    if (pending) return;
    if (preview) {
      setError("Preview only — attendance was not changed.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await jsonRequest(`/api/ops/experiences/${experienceId}/attendance`, {
        eventType,
        reason,
        registrationId: item.registrationId,
      });
      setReason("");
      await onChanged(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Attendance could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="rounded-[4px] bg-black/[0.035] px-4 py-4 sm:px-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(12rem,1fr)_9rem_minmax(13rem,0.7fr)] xl:items-end">
        <div>
          <p className="font-semibold text-black/80">{item.preferredName}</p>
          <p className="mt-1 text-xs text-black/45">
            {item.status.replaceAll("_", " ")}
            {item.waitlistPosition ? ` · waitlist ${item.waitlistPosition}` : ""}
            {` · ${formatDate(item.registeredAt)}`}
          </p>
        </div>
        <div>
          <p className="text-xs text-black/40">Attendance</p>
          <p className="mt-1 text-sm capitalize text-black/68">{item.attendanceState?.replaceAll("_", " ") ?? "Not marked"}</p>
        </div>
        {item.status === "registered" && canManageAttendance ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <FormField label="Attendance">
              <select
                className={OPERATOR_FIELD_CLASS}
                onChange={(event) => setAttendanceChoice(event.target.value)}
                value={attendanceChoice}
              >
                <option value="revoked">Not marked</option>
                <option value="checked_in">Check in</option>
                <option value="attended">Attended</option>
                <option value="no_show">No-show</option>
              </select>
            </FormField>
            <button
              className={quietButton}
              disabled={pending || attendanceChoice === (item.attendanceState ?? "revoked")}
              onClick={() => attendance(attendanceChoice)}
              type="button"
            >
              Save
            </button>
          </div>
        ) : <span />}
      </div>
      {canManageRoster && item.status !== "cancelled" ? (
        <details className="mt-3" open={item.status === "waitlisted"}>
          <summary className="min-h-11 w-fit cursor-pointer py-3 text-xs font-bold text-black/55 hover:text-black">
            {item.status === "waitlisted" ? "Confirm a place or remove from waitlist" : "Change registration"}
          </summary>
          <div className="grid gap-3 rounded-[4px] bg-black/[0.035] p-3 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-end">
            <FormField label="Reason when needed">
              <input
                className={OPERATOR_FIELD_CLASS}
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              {item.status === "waitlisted" ? (
                <button className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => roster("promote")} type="button">Confirm place</button>
              ) : null}
              {item.status === "registered" ? (
                <button className={quietButton} disabled={pending} onClick={() => roster("waitlist")} type="button">Move to waitlist</button>
              ) : null}
              <button
                className={`${OPERATOR_BUTTON_CLASS} !border-[var(--color-poster)] !bg-[var(--color-poster)]`}
                disabled={pending}
                onClick={() => roster("cancel")}
                type="button"
              >
                Cancel place
              </button>
            </div>
          </div>
        </details>
      ) : null}
      {error ? <p aria-live="assertive" className="mt-3 text-sm text-[var(--color-poster)]" role="alert">{error}</p> : null}
    </li>
  );
}

export default function OperatorExperienceRecord({
  directory,
  experience,
  preview = false,
}: {
  directory: Pick<OpsExperienceDirectory, "blocks" | "circles">;
  experience: ExperienceRecord;
  preview?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editRegistrationMode, setEditRegistrationMode] = useState(experience.registrationMode);
  const [editVisibility, setEditVisibility] = useState(experience.visibility);
  const [editingDetails, setEditingDetails] = useState(false);
  const [reviewingCancellation, setReviewingCancellation] = useState(false);
  const [reviewingPublish, setReviewingPublish] = useState(false);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [section, setSection] = useState<"overview" | "people" | "activity">("overview");
  const [eventOptionsOpen, setEventOptionsOpen] = useState(false);
  const [cancellationDirty, setCancellationDirty] = useState(false);
  const canEditDetails = experience.canEdit && ["draft", "published"].includes(experience.state);
  const calendarManaged = Boolean(experience.calendar.googleEventId)
    || ["pending_create", "pending_update", "pending_cancel"].includes(experience.calendar.status);
  const eventEnded = new Date(experience.endsAt ?? new Date(new Date(experience.startsAt).getTime() + 3_600_000).toISOString()).getTime() <= Date.now();
  const willQueue = experience.calendar.configured && !eventEnded;

  function openDetails() {
    setDetailsDirty(false);
    setEditRegistrationMode(experience.registrationMode);
    setEditVisibility(experience.visibility);
    setEditingDetails(true);
    setError(null);
  }
  function clearDialogHash() {
    if (["#edit-experience", "#experience-actions"].includes(window.location.hash)) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
  }
  function selectView(view: "overview" | "people" | "activity") {
    setSection(view);
    const hash = view === "people" ? "#experience-roster" : view === "activity" ? "#experience-activity" : "#meeting-setup";
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
  }
  useEffect(() => {
    function followHash() {
      const hash = window.location.hash;
      if (hash === "#experience-roster") setSection("people");
      else if (hash === "#experience-activity") setSection("activity");
      else if (["#meeting-setup", "#experience-calendar", "#experience-actions", "#edit-experience"].includes(hash)) setSection("overview");
      if (hash === "#edit-experience" && canEditDetails) {
        setEditRegistrationMode(experience.registrationMode);
        setEditVisibility(experience.visibility);
        setEditingDetails(true);
      }
      if (hash === "#experience-actions" && experience.canEdit && experience.state === "draft") setReviewingPublish(true);
      else if (hash === "#experience-actions" && experience.canEdit) setEventOptionsOpen(true);
      if (hash) requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "nearest" }));
    }
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, [canEditDetails, experience.canEdit, experience.registrationMode, experience.state, experience.visibility]);
  const registeredMemberIds = useMemo(
    () => new Set(experience.roster.map((item) => item.memberId).filter(Boolean)),
    [experience.roster],
  );
  const availableMembers = experience.memberOptions.filter((member) => !registeredMemberIds.has(member.id));

  async function changed() {
    // Calendar delivery is durably queued by the save transaction. Closing this
    // tab must not prevent it, and an independent provider retry is not a save failure.
    router.refresh();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (preview) {
      setError("Preview only — Experience changes were not saved.");
      return;
    }
    const data = new FormData(event.currentTarget);
    const visibility = String(data.get("visibility") ?? experience.visibility);
    const registrationMode = String(data.get("registrationMode") ?? experience.registrationMode);
    const capacityValue = String(data.get("capacity") ?? "").trim();
    const timezone = String(data.get("timezone") ?? experience.timezone).trim();
    setPending(true);
    setError(null);
    try {
      await jsonRequest(`/api/ops/experiences/${experience.experienceId}`, {
        blockId: visibility === "block" ? String(data.get("blockId") ?? "") || null : null,
        capacity: registrationMode === "internal" && capacityValue ? Number(capacityValue) : null,
        circleId: visibility === "circle" ? String(data.get("circleId") ?? "") || null : null,
        details: String(data.get("details") ?? ""),
        endsAt: zonedDateTimeLocalToIso(String(data.get("endsAt") ?? ""), timezone),
        externalRegistrationUrl: registrationMode === "external"
          ? String(data.get("externalRegistrationUrl") ?? "") || null
          : null,
        kind: String(data.get("kind") ?? experience.kind),
        locationLabel: String(data.get("locationLabel") ?? ""),
        registrationClosesAt: zonedDateTimeLocalToIso(String(data.get("registrationClosesAt") ?? ""), timezone),
        registrationMode,
        registrationOpensAt: zonedDateTimeLocalToIso(String(data.get("registrationOpensAt") ?? ""), timezone),
        startsAt: zonedDateTimeLocalToIso(String(data.get("startsAt") ?? ""), timezone) ?? "",
        summary: String(data.get("summary") ?? ""),
        timezone,
        title: String(data.get("title") ?? ""),
        visibility,
        waitlistEnabled: data.get("waitlistEnabled") === "on",
      }, "PATCH");
      setDetailsDirty(false);
      clearDialogHash();
      setEditingDetails(false);
      await changed();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The Experience could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function lifecycle(intent: "archive" | "cancel" | "complete" | "publish", reason = "") {
    if (pending) return;
    if (preview) {
      setError("Preview only — the Experience state was not changed.");
      return;
    }
    setPending(true);
    setError(null);
    let stateChanged = false;
    try {
      await jsonRequest(`/api/ops/experiences/${experience.experienceId}/lifecycle`, { intent, reason });
      stateChanged = true;
      setReviewingCancellation(false);
      setCancellationDirty(false);
      setEventOptionsOpen(false);
      setReviewingPublish(false);
      clearDialogHash();
      await changed();
    } catch (requestError) {
      setError(requestError instanceof Error
        ? stateChanged
          ? `The Experience state changed, but ${requestError.message}`
          : requestError.message
        : stateChanged
          ? "The Experience state changed, but its calendar invitations still need attention."
          : "The Experience state could not be changed.");
      if (stateChanged) router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (preview) {
      setError("Preview only — the member was not added.");
      return;
    }
    const form = event.currentTarget;
    const memberId = String(new FormData(form).get("memberId") ?? "");
    if (!memberId) return;
    setPending(true);
    setError(null);
    try {
      await jsonRequest(`/api/ops/experiences/${experience.experienceId}/registrations`, {
        action: "register",
        memberId,
      });
      form.reset();
      await changed();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The member could not be added.");
    } finally {
      setPending(false);
    }
  }

  return (
    <OperatorPageFrame title={experience.title}>
      <div className="mx-auto max-w-6xl pb-6">
      <Link className="mb-2 inline-flex min-h-11 items-center text-sm text-black/55 hover:text-black" href="/ops/experiences">← Events</Link>
      <header className="operator-record-header">
        <div className="min-w-0 flex-1">
          <h2 className="operator-record-title">{experience.title}</h2>
          <div className="mt-2"><StateLabel state={experience.state} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditDetails ? <button id="edit-experience-trigger" className={quietButton} disabled={pending} onClick={openDetails} type="button">Edit</button> : null}
          {experience.canEdit && experience.state === "draft" ? <button id="publish-experience-trigger" className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => { setError(null); setReviewingPublish(true); }} type="button">Review & publish</button> : null}
          {experience.canEdit ? <button id="event-options-trigger" aria-label="Event actions" className={`${quietButton} !px-3`} disabled={pending} onClick={() => { setError(null); setEventOptionsOpen(true); }} type="button"><span aria-hidden="true">•••</span></button> : null}
        </div>
      </header>

      <div className="inline-flex max-w-full gap-1 rounded-[8px] bg-black/[0.055] p-1" role="group" aria-label="Experience views">
        {(["overview", "people", "activity"] as const).map((view) => <button key={view} aria-pressed={section === view} aria-controls={`experience-view-${view}`} className={`min-h-11 rounded-[4px] px-4 text-sm font-semibold capitalize transition ${section === view ? "bg-[var(--color-bone)] text-black shadow-sm" : "text-black/55 hover:text-black"}`} onClick={() => selectView(view)} type="button">{view}</button>)}
      </div>
      {error && !editingDetails && !reviewingPublish && !eventOptionsOpen ? <p aria-live="assertive" className="mt-4 text-sm text-[var(--color-poster)]" role="alert">{error}</p> : null}

      <div className="mt-4">
        <div id="experience-view-people" hidden={section !== "people"}>
        <section className="scroll-mt-28" id="experience-roster" aria-labelledby="roster-title">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="operator-section-heading" id="roster-title">People</h2><p className="mt-1 text-sm text-black/55">{experience.registeredCount} confirmed · {experience.waitlistedCount} waiting{experience.capacity ? ` · ${experience.capacity} places` : ""}</p></div>
            {experience.canManageRoster && experience.registrationMode === "internal" && availableMembers.length > 0 ? (
              <form className="flex flex-wrap gap-2" onSubmit={addMember}>
                <label className="sr-only" htmlFor="experience-member">Member</label>
                <select className={OPERATOR_FIELD_CLASS} defaultValue="" id="experience-member" name="memberId" required>
                  <option disabled value="">Choose member</option>
                  {availableMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
                <button className={OPERATOR_BUTTON_CLASS} disabled={pending} type="submit">Add member</button>
              </form>
            ) : null}
          </div>
          <ul className="mt-5 space-y-2">
            {experience.roster.map((item) => (
              <RosterRow
                canManageAttendance={experience.canManageAttendance}
                canManageRoster={experience.canManageRoster}
                experienceId={experience.experienceId}
                item={item}
                key={item.registrationId}
                onChanged={changed}
                preview={preview}
              />
            ))}
          </ul>
          {experience.roster.length === 0 ? <p className="mt-5 rounded-[4px] bg-white/50 px-4 py-5 text-sm text-black/55">{experience.registrationMode !== "internal" ? "Registration is not managed here for this Experience." : availableMembers.length && experience.canManageRoster ? "No reservations yet. Choose a member above to add a place." : "No reservations yet. Eligible members can register once this Experience is published and registration opens."}</p> : null}
        </section>
        </div>

        <div id="experience-view-overview" hidden={section !== "overview"}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6" aria-label="Event snapshot">
            <section className="operator-bento-card col-span-2 lg:col-span-2" aria-label="Schedule">
              <span className="operator-compact-label">Schedule</span>
              <p className="mt-2 text-base font-semibold">{formatDate(experience.startsAt, experience.timezone)}</p>
              {experience.endsAt ? <p className="mt-1 text-xs text-black/60">Until {formatDate(experience.endsAt, experience.timezone)}</p> : null}
              <p className="mt-2 text-xs text-black/50">{experience.timezone}</p>
            </section>
            <section className="operator-bento-card lg:col-span-2" aria-label="Audience">
              <span className="operator-compact-label">Audience</span>
              <p className="mt-2 break-words text-sm font-semibold">{experience.circleId ? <Link className="underline underline-offset-4" href={`/ops/circles?circleId=${encodeURIComponent(experience.circleId)}`}>{experience.scope}</Link> : experience.scope}</p>
              <button className="mt-1 inline-flex min-h-11 items-center text-left text-xs text-black/60 underline underline-offset-4" onClick={() => selectView("people")} type="button">{experience.registeredCount} confirmed{experience.waitlistedCount ? ` · ${experience.waitlistedCount} waiting` : ""} →</button>
            </section>
            <section className="operator-bento-card lg:col-span-2" aria-label="Location">
              <span className="operator-compact-label">Location</span>
              <p className="mt-2 break-words text-sm font-semibold">{experience.locationLabel || (experience.meetingUrl ? "Google Meet" : "Not set")}</p>
            </section>
          <div id="meeting-setup" className="col-span-2 scroll-mt-28 lg:col-span-3">
          <OperatorExperienceCalendar
            calendar={experience.calendar}
            canManage={experience.canManageCommunication}
            canBind={experience.canManageGlobal}
            experienceId={experience.experienceId}
            experienceState={experience.state}
            preview={preview}
            scope={experience.scope}
            meetingUrl={experience.meetingUrl}
            linksEnabled={experience.googleCommunicationsConfigured}
            audienceReviewHref={experience.circleId ? `/ops/circles?circleId=${encodeURIComponent(experience.circleId)}` : "#experience-roster"}
            audienceReviewLabel={experience.circleId ? "Review Circle" : "Review people"}
          >
            {calendarManaged ? <p className="text-sm text-black/60">Google Calendar manages this meeting link.</p> : <>
              <p className="mb-3 text-sm text-black/60">Use a Meet link you already have. Saving does not send invitations. If you later send Google Calendar invitations, Google creates a new link and replaces this one.</p>
              <OperatorGoogleCommunicationField configured={experience.googleCommunicationsConfigured} editable={experience.canManageCommunication && !["cancelled", "archived", "completed"].includes(experience.state)} entityId={experience.experienceId} entityType="experience" initialUrl={experience.meetingUrl} kind="meet" inline preview={preview} />
            </>}
          </OperatorExperienceCalendar>
          </div>
          <section className="operator-bento-card col-span-2 lg:col-span-3" aria-label="Event details">
            <h2 className="operator-section-heading">Event details</h2>
            {experience.summary ? <p className="mt-2 text-sm leading-relaxed text-black/65">{experience.summary}</p> : null}
            {experience.details ? <details className="mt-1"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Read description</summary><p className="whitespace-pre-line pb-2 text-sm leading-relaxed text-black/65">{experience.details}</p></details> : null}
            <p className="mt-2 text-xs text-black/60">{experience.registrationMode === "internal" ? `Reservations managed here${experience.waitlistEnabled ? " · Waitlist enabled" : ""}` : experience.registrationMode === "external" ? "Registration with an external provider" : "No reservation required"}</p>
            {experience.registrationOpensAt || experience.registrationClosesAt ? <details><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-black/60">Registration window</summary><p className="text-xs leading-relaxed text-black/60">{experience.registrationOpensAt ? `Opens ${formatDate(experience.registrationOpensAt, experience.timezone)}` : "Open now"}{experience.registrationClosesAt ? ` · Closes ${formatDate(experience.registrationClosesAt, experience.timezone)}` : ""}</p></details> : null}
          </section>
          </div>
        </div>
      </div>

          {experience.canEdit ? (
            <OperatorDialog open={eventOptionsOpen} title="Event actions" pending={pending} returnFocusId="event-options-trigger" onClose={() => { setEventOptionsOpen(false); setReviewingCancellation(false); setCancellationDirty(false); clearDialogHash(); }}>
              <div className="scroll-mt-28" id="experience-actions">
              <p className="text-sm font-medium">{experience.title}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {experience.state === "published" ? <button className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => lifecycle("complete")} type="button">Complete</button> : null}
                {["draft", "cancelled", "completed"].includes(experience.state) ? <button className={quietButton} disabled={pending} onClick={() => lifecycle("archive")} type="button">Archive</button> : null}
              </div>
              {experience.state === "published" && !reviewingCancellation ? <button className="mt-3 min-h-11 px-2 text-sm text-[var(--color-poster)] underline underline-offset-4" disabled={pending} onClick={() => setReviewingCancellation(true)} type="button">Cancel Experience</button> : null}
              {experience.state === "published" && reviewingCancellation ? (
                <form className="mt-4 grid gap-2" data-operator-dirty={cancellationDirty ? "true" : "false"} onChange={() => setCancellationDirty(true)} onSubmit={(event) => {
                  event.preventDefault();
                  const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
                  void lifecycle("cancel", reason);
                }}>
                  <p className="text-sm leading-relaxed text-black/65">Cancel {experience.title}? It will no longer appear as an upcoming Experience. If a Google invitation exists, its cancellation will be queued.</p>
                  <FormField label="Cancellation reason">
                    <input className={OPERATOR_FIELD_CLASS} minLength={3} name="reason" required />
                  </FormField>
                  <button className={`${OPERATOR_BUTTON_CLASS} !border-[var(--color-poster)] !bg-[var(--color-poster)]`} disabled={pending} type="submit">Confirm cancellation</button>
                  <button className="min-h-11 px-2 text-sm underline underline-offset-4" disabled={pending} onClick={() => { setReviewingCancellation(false); setCancellationDirty(false); }} type="button">Keep Experience</button>
                </form>
              ) : null}
              {!['draft', 'published', 'cancelled', 'completed'].includes(experience.state) ? <p className="mt-3 text-sm text-black/55">This event is archived.</p> : null}
              {error ? <p role="alert" className="mt-3 text-sm text-[var(--color-poster)]">{error}</p> : null}
              </div>
            </OperatorDialog>
          ) : null}

      {canEditDetails && editingDetails ? (
        <OperatorDialog open title="Edit Experience" pending={pending} returnFocusId="edit-experience-trigger" onClose={() => { setEditingDetails(false); setDetailsDirty(false); clearDialogHash(); }}>
          <form id="edit-experience" data-operator-dirty={detailsDirty ? "true" : "false"} data-operator-pending={pending ? "true" : "false"} className="grid gap-4 pb-3 pt-2 sm:grid-cols-2" onChange={() => setDetailsDirty(true)} onSubmit={save}>
            <FormField className="sm:col-span-2" label="Title">
              <input className={OPERATOR_FIELD_CLASS} defaultValue={experience.title} maxLength={200} name="title" required />
            </FormField>
            {experience.canManageGlobal ? (
              <>
                <FormField label="Type">
                  <select className={OPERATOR_FIELD_CLASS} defaultValue={experience.kind} name="kind">
                    <option value="member_event">Member event</option>
                    <option value="circle_meeting">Circle meeting</option>
                    <option value="weekly_call">Weekly call</option>
                    <option value="public_event">Public event</option>
                    <option value="academy_session">Academy session</option>
                    <option value="challenge">Challenge</option>
                    <option value="retreat">Retreat</option>
                  </select>
                </FormField>
                <FormField label="Audience">
                  <select
                    className={OPERATOR_FIELD_CLASS}
                    name="visibility"
                    onChange={(event) => setEditVisibility(event.target.value as typeof editVisibility)}
                    value={editVisibility}
                  >
                    <option value="all_members">All active members</option>
                    <option value="public">Public</option>
                    <option value="invite_only">Invite only</option>
                    {directory.circles.length ? <option value="circle">Circle</option> : null}
                    {directory.blocks.length ? <option value="block">Block</option> : null}
                  </select>
                </FormField>
              </>
            ) : (
              <>
                <input name="kind" type="hidden" value={experience.kind} />
                <input name="visibility" type="hidden" value={experience.visibility} />
              </>
            )}
            {editVisibility === "circle" && directory.circles.length ? (
              <FormField label="Circle">
                <select className={OPERATOR_FIELD_CLASS} defaultValue={experience.circleId ?? directory.circles[0]?.id} name="circleId" required>
                  {directory.circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
                </select>
              </FormField>
            ) : null}
            {editVisibility === "block" && directory.blocks.length ? (
              <FormField label="Block">
                <select className={OPERATOR_FIELD_CLASS} defaultValue={experience.blockId ?? directory.blocks[0]?.id} name="blockId" required>
                  {directory.blocks.map((block) => <option key={block.id} value={block.id}>{block.name}</option>)}
                </select>
              </FormField>
            ) : null}
            <FormField label="Starts">
              <input className={OPERATOR_FIELD_CLASS} defaultValue={zonedDateTimeLocalValue(experience.startsAt, experience.timezone)} name="startsAt" required type="datetime-local" />
            </FormField>
            <FormField label="Ends">
              <input className={OPERATOR_FIELD_CLASS} defaultValue={zonedDateTimeLocalValue(experience.endsAt, experience.timezone)} name="endsAt" type="datetime-local" />
            </FormField>
            <FormField label="Timezone">
              <input className={OPERATOR_FIELD_CLASS} defaultValue={experience.timezone} name="timezone" required />
            </FormField>
            <FormField label="Place">
              <input className={OPERATOR_FIELD_CLASS} defaultValue={experience.locationLabel ?? ""} maxLength={500} name="locationLabel" />
            </FormField>
            <FormField label="Registration">
              <select
                className={OPERATOR_FIELD_CLASS}
                name="registrationMode"
                onChange={(event) => setEditRegistrationMode(event.target.value as typeof editRegistrationMode)}
                value={editRegistrationMode}
              >
                <option value="internal">Managed here</option>
                <option value="none">No reservation</option>
                <option value="external">External link</option>
              </select>
            </FormField>
            {editRegistrationMode === "internal" ? (
              <>
                <FormField label="Capacity">
                  <input className={OPERATOR_FIELD_CLASS} defaultValue={experience.capacity ?? ""} min={1} name="capacity" placeholder="Unlimited" type="number" />
                </FormField>
                <FormField label="Registration opens">
                  <input className={OPERATOR_FIELD_CLASS} defaultValue={zonedDateTimeLocalValue(experience.registrationOpensAt, experience.timezone)} name="registrationOpensAt" type="datetime-local" />
                </FormField>
                <FormField label="Registration closes">
                  <input className={OPERATOR_FIELD_CLASS} defaultValue={zonedDateTimeLocalValue(experience.registrationClosesAt, experience.timezone)} name="registrationClosesAt" type="datetime-local" />
                </FormField>
                <label className="flex min-h-12 items-center gap-3 self-end text-sm text-black/60">
                  <input defaultChecked={experience.waitlistEnabled} name="waitlistEnabled" type="checkbox" />
                  Start a waitlist when full
                </label>
              </>
            ) : null}
            {editRegistrationMode === "external" ? (
              <FormField className="sm:col-span-2" label="External registration link">
                <input className={OPERATOR_FIELD_CLASS} defaultValue={experience.externalRegistrationUrl ?? ""} name="externalRegistrationUrl" placeholder="https://" required type="url" />
              </FormField>
            ) : null}
            <FormField className="sm:col-span-2" label="Short summary">
              <textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} defaultValue={experience.summary ?? ""} maxLength={2000} name="summary" />
            </FormField>
            <FormField className="sm:col-span-2" label="Full details">
              <textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} defaultValue={experience.details ?? ""} maxLength={20000} name="details" />
            </FormField>
            <button className={`${OPERATOR_BUTTON_CLASS} sm:col-span-2`} disabled={pending} type="submit">{pending ? "Saving" : "Save changes"}</button>
          </form>
          {error ? <p role="alert" className="mt-3 text-sm text-[var(--color-poster)]">{error}</p> : null}
        </OperatorDialog>
      ) : null}

      {experience.canEdit && experience.state === "draft" && reviewingPublish ? <OperatorDialog open title="Publish Experience" pending={pending} returnFocusId="publish-experience-trigger" onClose={() => { setReviewingPublish(false); clearDialogHash(); }}>
        <div className="space-y-4 text-sm" data-operator-pending={pending ? "true" : "false"}>
          <p className="font-semibold">{experience.title}</p>
          <p>{formatDate(experience.startsAt, experience.timezone)} · {experience.scope}</p>
          <p>{willQueue ? `Publishing makes this Experience visible and queues Google Calendar invitations for ${experience.calendar.attendeeCount} ${experience.calendar.attendeeCount === 1 ? "person" : "people"}. Delivery status appears in Meeting; queued does not mean sent.` : eventEnded ? "This event has ended. Publishing makes it visible but will not automatically send Google invitations." : "Publishing makes this Experience visible. Google invitations will not be sent automatically while Calendar setup needs attention."}</p>
          {experience.calendar.attendeeCount === 0 && willQueue ? <p className="rounded-[4px] bg-[var(--color-highlight)]/35 p-3">No one is currently eligible for an invitation. Review the audience before publishing; a Google event can still be created for the organizer.</p> : null}
          {experience.meetingUrl && willQueue && !calendarManaged ? <p className="text-[var(--color-poster)]">Google will replace your saved meeting link with a new Meet link.</p> : null}
          <button className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => lifecycle("publish")} type="button">{pending ? "Publishing" : willQueue ? "Publish + queue invitations" : "Publish Experience"}</button>
          {error ? <p role="alert" className="text-[var(--color-poster)]">{error}</p> : null}
        </div>
      </OperatorDialog> : null}

      <section id="experience-view-activity" hidden={section !== "activity"} className="mt-6" aria-labelledby="history-title">
        <h2 className="operator-section-heading" id="history-title">Activity</h2>
        <span id="experience-activity" />
        <ol className="mt-4 grid gap-2">
          {experience.history.map((item) => <li className="grid gap-1 rounded-[4px] bg-white/55 px-4 py-3 text-sm sm:grid-cols-[10rem_1fr_12rem]" key={`${item.occurredAt}-${item.eventType}`}><time className="text-black/42">{formatDate(item.occurredAt, experience.timezone)}</time><span className="capitalize text-black/70">{item.eventType.replaceAll("_", " ")}{item.reason ? ` · ${item.reason}` : ""}</span><span className="text-black/42">{item.actor ?? "System"}</span></li>)}
        </ol>
        {experience.history.length === 0 ? <p className="mt-4 text-sm text-black/55">No activity yet.</p> : null}
      </section>
      </div>
    </OperatorPageFrame>
  );
}
