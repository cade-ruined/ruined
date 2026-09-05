"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import OperatorExperienceCalendar from "@/components/platform/OperatorExperienceCalendar";
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
        <details className="mt-3">
          <summary className="min-h-11 w-fit cursor-pointer py-3 text-xs font-bold text-black/55 hover:text-black">
            Manage place
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
                <button className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => roster("promote")} type="button">Promote</button>
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
      <div className="mx-auto max-w-[92rem] pb-20">
      <Link className="text-sm text-black/50 hover:text-black" href="/ops/experiences">← Experiences</Link>
      <header className="mt-5 grid gap-5 rounded-[4px] bg-[#080605] px-6 py-7 text-[var(--color-bone)] sm:px-8 lg:grid-cols-[minmax(0,1fr)_14rem] lg:items-end">
        <div>
          <p className="text-sm capitalize text-white/45">{experience.kind.replaceAll("_", " ")} · {experience.scope}</p>
          <h1 className="mt-3 max-w-[18ch] font-[var(--font-display)] text-[clamp(2.4rem,5vw,4.75rem)] leading-[0.88] tracking-[-0.04em]">{experience.title}</h1>
          <p className="mt-5 text-sm text-white/55">{formatDate(experience.startsAt, experience.timezone)}{experience.locationLabel ? ` · ${experience.locationLabel}` : ""}</p>
        </div>
        <div className="grid gap-3">
          <StateLabel state={experience.state} />
          <p className="text-sm text-white/55">{experience.registeredCount} confirmed · {experience.waitlistedCount} waiting{experience.capacity ? ` · ${experience.capacity} capacity` : ""}</p>
        </div>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <section className="rounded-[4px] bg-black/[0.035] px-5 py-5 sm:px-6" aria-labelledby="roster-title">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="[font-family:var(--font-cadehandy2)] text-2xl text-[var(--color-poster)]">People</p><h2 className="font-[var(--font-display)] text-3xl" id="roster-title">Roster</h2></div>
            {experience.canManageRoster && experience.registrationMode === "internal" && availableMembers.length > 0 ? (
              <form className="flex flex-wrap gap-2" onSubmit={addMember}>
                <label className="sr-only" htmlFor="experience-member">Member</label>
                <select className={OPERATOR_FIELD_CLASS} defaultValue="" id="experience-member" name="memberId" required>
                  <option disabled value="">Choose member</option>
                  {availableMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
                <button className={OPERATOR_BUTTON_CLASS} disabled={pending} type="submit">Add</button>
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
          {experience.roster.length === 0 ? <p className="mt-5 rounded-[4px] bg-white/50 px-4 py-8 text-sm text-black/48">No one is on this roster yet.</p> : null}
        </section>

        <aside className="order-first space-y-4 lg:order-none">
          <OperatorExperienceCalendar
            calendar={experience.calendar}
            canManage={experience.canManageCommunication}
            canBind={experience.canManageGlobal}
            experienceId={experience.experienceId}
            experienceState={experience.state}
            preview={preview}
            scope={experience.scope}
          />
          <details className="rounded-[4px] bg-black/[0.035] px-5 py-4">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-black/60">Manual Meet fallback</summary>
            <div className="pt-3">
              <OperatorGoogleCommunicationField
                configured={experience.googleCommunicationsConfigured}
                editable={experience.canManageCommunication}
                entityId={experience.experienceId}
                entityType="experience"
                initialUrl={experience.meetingUrl}
                kind="meet"
                preview={preview}
              />
            </div>
          </details>
          {experience.canEdit ? (
            <section className="rounded-[4px] bg-black/[0.035] px-5 py-5" aria-label="Experience actions">
              <p className="[font-family:var(--font-cadehandy2)] text-2xl text-[var(--color-poster)]">State</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {experience.state === "draft" ? <button className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => lifecycle("publish")} type="button">{experience.calendar.configured ? "Publish + send invite" : "Publish"}</button> : null}
                {experience.state === "published" ? <button className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => lifecycle("complete")} type="button">Complete</button> : null}
                {["draft", "cancelled", "completed"].includes(experience.state) ? <button className={quietButton} disabled={pending} onClick={() => lifecycle("archive")} type="button">Archive</button> : null}
              </div>
              {experience.state === "published" ? (
                <form className="mt-4 grid gap-2" onSubmit={(event) => {
                  event.preventDefault();
                  const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
                  void lifecycle("cancel", reason);
                }}>
                  <FormField label="Cancellation reason">
                    <input className={OPERATOR_FIELD_CLASS} minLength={3} name="reason" required />
                  </FormField>
                  <button className={`${OPERATOR_BUTTON_CLASS} !border-[var(--color-poster)] !bg-[var(--color-poster)]`} disabled={pending} type="submit">Cancel Experience</button>
                </form>
              ) : null}
            </section>
          ) : null}
          {error ? <p aria-live="assertive" className="rounded-[4px] bg-[var(--color-poster)]/10 px-4 py-3 text-sm text-[var(--color-poster)]" role="alert">{error}</p> : null}
        </aside>
      </div>

      {experience.canEdit && ["draft", "published"].includes(experience.state) ? (
        <details className="mt-5 rounded-[4px] bg-black/[0.035] px-5 py-4 sm:px-6">
          <summary className="min-h-11 cursor-pointer py-3 font-[var(--font-display)] text-2xl">Edit Experience</summary>
          <form className="grid gap-4 pb-3 pt-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={save}>
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
        </details>
      ) : null}

      <section className="mt-5 rounded-[4px] bg-black/[0.025] px-5 py-5 sm:px-6" aria-labelledby="history-title">
        <p className="[font-family:var(--font-cadehandy2)] text-2xl text-[var(--color-poster)]">Record</p>
        <h2 className="font-[var(--font-display)] text-3xl" id="history-title">History</h2>
        <ol className="mt-4 grid gap-2">
          {experience.history.map((item) => <li className="grid gap-1 rounded-[4px] bg-white/55 px-4 py-3 text-sm sm:grid-cols-[10rem_1fr_12rem]" key={`${item.occurredAt}-${item.eventType}`}><time className="text-black/42">{formatDate(item.occurredAt, experience.timezone)}</time><span className="capitalize text-black/70">{item.eventType.replaceAll("_", " ")}{item.reason ? ` · ${item.reason}` : ""}</span><span className="text-black/42">{item.actor ?? "System"}</span></li>)}
        </ol>
      </section>
      </div>
    </OperatorPageFrame>
  );
}
