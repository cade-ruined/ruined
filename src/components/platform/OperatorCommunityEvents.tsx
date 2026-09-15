"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorDialog from "@/components/platform/OperatorDialog";
import { OPERATOR_FIELD_CLASS, OPERATOR_LABEL_CLASS, OPERATOR_LABEL_TEXT_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";
import { zonedDateTimeLocalToIso, zonedDateTimeLocalValue } from "@/lib/datetime/zoned-date-time";
import type { CommunityEventRecord, CommunityEventRegistrant } from "@/lib/events/community-event-model";
import { getByobRegistrationConfig } from "@/lib/events/byob-registration-model";

function Field({ children, label }: { children: ReactNode; label: string }) {
  return <label className={OPERATOR_LABEL_CLASS}><span className={OPERATOR_LABEL_TEXT_CLASS}>{label}</span>{children}</label>;
}

export function CommunityEventEditor({ event, preview = false }: { event?: CommunityEventRecord; preview?: boolean }) {
  const nativeRegistration = event ? getByobRegistrationConfig(event.eventKey) : null;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState(nativeRegistration ? "byob" : event?.registrationMode ?? "none");
  const [timezone, setTimezone] = useState(event?.timezone ?? "America/Denver");
  const [editing, setEditing] = useState(!event);
  const [failed, setFailed] = useState(false);
  async function save(action: FormEvent<HTMLFormElement>) {
    action.preventDefault();
    if (pendingRef.current || preview) return;
    pendingRef.current = true;
    const data = new FormData(action.currentTarget);
    setPending(true); setMessage(""); setFailed(false);
    try {
      const value = (name: string) => String(data.get(name) ?? "");
      const response = await fetch("/api/ops/community-events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: event?.version ?? null, event: {
          eventKey: event?.eventKey ?? value("eventKey"), title: value("title"), eyebrow: value("eyebrow"),
          startsAt: zonedDateTimeLocalToIso(value("startsAt"), timezone), timezone,
          location: value("location"), admission: value("admission"), summary: value("summary"),
          imagePath: value("imagePath"), videoPath: value("videoPath"), videoPosterPath: value("videoPosterPath"),
          publicationState: value("publicationState"), eventState: value("eventState"), registrationMode: mode,
          registrationUrl: value("registrationUrl"), registrationOpen: data.get("registrationOpen") === "on",
        } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The event could not be saved.");
      setMessage("Event saved.");
      setDirty(false);
      if (event) setEditing(false);
      if (!event) router.push(`/ops/community/${result.event.eventKey}`);
      router.refresh();
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "The event could not be saved."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  const savedSummary = event ? <section aria-label="Event details">
    <header className="operator-record-header">
      <div><h2 className="operator-record-title">{event.title}</h2><p className="mt-2 text-xs text-black/60">{event.publicationState === "published" ? "Published on website" : event.publicationState === "archived" ? "Archived — hidden from website" : "Draft — hidden from website"} · {event.eventState}</p></div>
      <button id="edit-public-event" className="min-h-11 rounded-[8px] bg-black/[0.055] px-4 text-sm font-medium" onClick={() => { setEditing(true); setMessage(""); setFailed(false); setMode(nativeRegistration ? "byob" : event.registrationMode); setTimezone(event.timezone); }} type="button">Edit event</button>
    </header>
    <dl className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
      <div className="operator-bento-card col-span-2 sm:col-span-1"><dt className="operator-compact-label">Schedule</dt><dd className="mt-2 font-medium">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: event.timezone }).format(new Date(event.startsAt))}<span className="mt-1 block text-xs font-normal text-black/55">{event.timezone}</span></dd></div>
      <div className="operator-bento-card"><dt className="operator-compact-label">Location</dt><dd className="mt-2">{event.location || "Not set"}</dd></div>
      <div className="operator-bento-card"><dt className="operator-compact-label">Admission</dt><dd className="mt-2">{event.admission || "Not set"}</dd></div>
      <div className="operator-bento-card col-span-2 sm:col-span-1"><dt className="operator-compact-label">Registration</dt><dd className="mt-2">{event.registrationMode === "none" ? "No registration required" : `${event.registrationOpen ? "Open" : "Closed"} · ${event.registrationMode === "byob" ? "Ruined BYOB registration" : "External provider"}`}{event.registrationMode === "external" && event.registrationUrl ? <a className="mt-1 inline-flex min-h-11 items-center break-all underline underline-offset-4" href={event.registrationUrl} rel="noopener noreferrer" target="_blank">Open registration ↗</a> : null}</dd></div>
    </dl>
    {event.summary ? <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Event description</summary><p className="whitespace-pre-line text-sm leading-relaxed text-black/65">{event.summary}</p></details> : null}
    {preview ? <p className="mt-4 text-sm text-black/60">Preview only. Event and attendance changes are not saved.</p> : null}
    {message ? <p role="status" className="mt-3 text-sm">{message}</p> : null}
  </section> : null;
  const editor = <form onSubmit={save} onChange={() => setDirty(true)} data-operator-pending={pending} data-operator-dirty={dirty} className="space-y-4" aria-label={event ? "Edit event details" : "New event details"}>
    {preview ? <p className="text-sm text-black/60">Preview only. Event and attendance changes are not saved.</p> : null}
    <fieldset disabled={pending || preview} className="grid gap-4 sm:grid-cols-2">
      <Field label="Event name"><input className={OPERATOR_FIELD_CLASS} name="title" defaultValue={event?.title} required maxLength={160} /></Field>
      <Field label="Event link"><input className={OPERATOR_FIELD_CLASS} name="eventKey" defaultValue={event?.eventKey} readOnly={Boolean(event)} placeholder="byob-03" pattern="[a-z0-9]+(-[a-z0-9]+)*" required maxLength={80} /></Field>
      <Field label="Date and time"><input className={OPERATOR_FIELD_CLASS} name="startsAt" type="datetime-local" defaultValue={zonedDateTimeLocalValue(event?.startsAt ?? null, event?.timezone ?? "America/Denver")} required /></Field>
      <Field label="Time zone"><input className={OPERATOR_FIELD_CLASS} value={timezone} onChange={(e) => setTimezone(e.target.value)} required list="community-timezones" /><datalist id="community-timezones"><option value="America/Denver" /><option value="America/Los_Angeles" /><option value="America/Chicago" /><option value="America/New_York" /><option value="UTC" /></datalist></Field>
      <Field label="Location"><input className={OPERATOR_FIELD_CLASS} name="location" defaultValue={event?.location} maxLength={300} /></Field>
      <Field label="Admission"><input className={OPERATOR_FIELD_CLASS} name="admission" defaultValue={event?.admission} placeholder="Free / Tickets / Details to come" maxLength={200} /></Field>
      <Field label="Website visibility"><select className={OPERATOR_FIELD_CLASS} name="publicationState" defaultValue={event?.publicationState ?? "draft"}><option value="draft">Draft — hidden from the website</option><option value="published">Published — on the website</option><option value="archived">Archived — hidden, records retained</option></select></Field>
      <Field label="Event status"><select className={OPERATOR_FIELD_CLASS} name="eventState" defaultValue={event?.eventState ?? "Upcoming"}><option value="Upcoming">Upcoming</option><option value="Ongoing">Happening now</option><option value="Ended">Previously held</option></select></Field>
      <Field label="Short label"><input className={OPERATOR_FIELD_CLASS} name="eyebrow" defaultValue={event?.eyebrow ?? "Community gathering"} maxLength={100} /></Field>
      <Field label="Registration"><select className={OPERATOR_FIELD_CLASS} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} disabled={Boolean(nativeRegistration)}>{nativeRegistration ? <option value="byob">Existing BYOB registration</option> : <><option value="none">No registration</option><option value="external">External registration link</option></>}</select></Field>
      <div className="sm:col-span-2"><Field label="Description"><textarea className={`${OPERATOR_FIELD_CLASS} min-h-24`} name="summary" defaultValue={event?.summary} maxLength={3000} /></Field></div>
      {mode === "external" ? <div className="sm:col-span-2"><Field label="External registration link"><input className={OPERATOR_FIELD_CLASS} name="registrationUrl" type="url" placeholder="https://" defaultValue={event?.registrationUrl ?? ""} required /></Field><p className="mt-2 text-sm text-black/55">Registration, waivers, capacity and attendee records stay with that provider.</p></div> : null}
      {mode !== "none" ? <label className="flex items-center gap-3 text-sm sm:col-span-2"><input name="registrationOpen" type="checkbox" defaultChecked={event?.registrationOpen ?? false} className="h-5 w-5 accent-black" />Registration open</label> : null}
      <Field label="Image path"><input className={OPERATOR_FIELD_CLASS} name="imagePath" defaultValue={event?.imagePath ?? ""} placeholder="/events/your-image.webp" /></Field>
      <Field label="Recap video path"><input className={OPERATOR_FIELD_CLASS} name="videoPath" defaultValue={event?.videoPath ?? ""} placeholder="/events/your-video.mp4" /></Field>
      <Field label="Video poster path"><input className={OPERATOR_FIELD_CLASS} name="videoPosterPath" defaultValue={event?.videoPosterPath ?? ""} placeholder="/events/your-poster.webp" /></Field>
      <p className="self-end text-sm text-black/55">Use existing site media paths. The current BYOB gallery and photo credits are preserved.</p>
    </fieldset>
    <div className="flex flex-wrap items-center gap-4"><button className={OPERATOR_PRIMARY_ACTION_CLASS} type="submit" disabled={pending || preview}>{pending ? "Saving…" : event ? "Save event" : "Create event"}</button><p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-[var(--color-poster)]" : ""}`}>{message}</p></div>
  </form>;
  return event ? <>{savedSummary}{editing ? <OperatorDialog open title="Edit public event" pending={pending} returnFocusId="edit-public-event" onClose={() => { setEditing(false); setDirty(false); setMessage(""); setFailed(false); }}>{editor}</OperatorDialog> : null}</> : editor;
}

export default function OperatorCommunityEvents({ events, navigation, preview = false }: { events: CommunityEventRecord[]; navigation?: ReactNode; preview?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const visible = events.filter((event) => `${event.title} ${event.location} ${event.eventKey}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <OperatorPageFrame title="Public community">
    {navigation}
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div className="min-w-0 flex-1"><Field label="Find an event"><input className={OPERATOR_FIELD_CLASS} value={query} onChange={(e) => setQuery(e.target.value)} type="search" /></Field></div><button className={OPERATOR_PRIMARY_ACTION_CLASS} type="button" id="add-public-event" aria-haspopup="dialog" onClick={() => setAdding(true)}>Add public event</button></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((event) => <article key={event.eventKey} className="operator-bento-card flex flex-col justify-between gap-3">
      <div><p className="text-xs text-black/55">{event.publicationState === "published" ? event.eventState : event.publicationState === "draft" ? "Draft" : "Archived"} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: event.timezone }).format(new Date(event.startsAt))}</p><h2 className="operator-section-heading mt-2">{event.title}</h2><p className="mt-2 text-xs text-black/65">{event.registrationMode === "external" ? "Registrations with external provider" : event.registrationMode === "byob" ? `${event.registeredCount} registered · ${event.attendanceCount} checked in` : "No registration required"}</p></div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold sm:mt-0"><Link href={`/ops/community/${event.eventKey}`}>Manage event →</Link>{event.registrationMode === "byob" ? <Link href={`/ops/community/${event.eventKey}#registrations`}>View roster →</Link> : null}</div>
    </article>)}</div>
    {!visible.length ? <p className="py-6 text-black/60">No events match this search.</p> : null}
    {adding ? <OperatorDialog open title="New public event" onClose={() => setAdding(false)} returnFocusId="add-public-event"><div id="new-community-event"><CommunityEventEditor preview={preview} /></div></OperatorDialog> : null}
  </OperatorPageFrame>;
}

export function CommunityRoster({ eventKey, registrations, preview = false }: { eventKey: string; registrations: CommunityEventRegistrant[]; preview?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  async function recordAttendance(registration: CommunityEventRegistrant, state: string) {
    if (pending || preview) return;
    setPending(registration.id); setMessage("");
    try {
      const response = await fetch(`/api/ops/community-events/${eventKey}/attendance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registrationId: registration.id, attendanceState: state, expectedEventId: registration.attendanceEventId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Attendance could not be saved.");
      setMessage(`Attendance saved for ${registration.name}.`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Attendance could not be saved."); }
    finally { setPending(null); }
  }
  return <><p role="status" className="mb-3 text-sm">{message}</p><div className="grid gap-3">{registrations.map((registration) => <article key={registration.id} className="rounded-lg bg-black/[0.045] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
    <div className="min-w-0"><h3 className="ui-heading text-lg">{registration.name}</h3><a className="break-all text-sm underline underline-offset-4" href={`mailto:${registration.email}`}>{registration.email}</a><p className="mt-1 text-xs text-black/55">{registration.status === "cancelled" ? "Cancelled" : "Registered"} · Waiver accepted {new Date(registration.waiverAcceptedAt).toLocaleDateString("en-US")}</p><p className="mt-1 break-all text-xs text-black/50">{registration.waiverVersion}</p></div>
    <label className="mt-3 block sm:mt-0"><span className={`${OPERATOR_LABEL_TEXT_CLASS} mb-1 block`}>Attendance</span><select aria-label={`Attendance for ${registration.name}`} className={OPERATOR_FIELD_CLASS} value={registration.attendanceState} disabled={preview || pending !== null || registration.status !== "registered"} onChange={(e) => void recordAttendance(registration, e.target.value)}><option value="not_recorded">Not recorded</option><option value="present">Checked in</option><option value="absent">Did not attend</option></select></label>
  </article>)}</div>{!registrations.length ? <p className="py-5 text-black/60">No registrations match this search.</p> : null}</>;
}
