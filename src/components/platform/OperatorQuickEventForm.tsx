"use client";

import { type FormEvent, useState } from "react";

import OperatorDateTimeField from "@/components/platform/OperatorDateTimeField";
import {
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
  OPERATOR_PRIMARY_ACTION_CLASS,
} from "@/components/platform/operatorStyles";
import { zonedDateTimeLocalToIso } from "@/lib/datetime/zoned-date-time";
import type { OpsExperienceDirectory } from "@/lib/platform/ops-experience-model";

export default function OperatorQuickEventForm({
  directory,
  selectedCircle,
  preview = false,
  onAdvanced,
  onCreated,
  onPendingChange,
}: {
  directory: OpsExperienceDirectory;
  selectedCircle?: OpsExperienceDirectory["circles"][number];
  preview?: boolean;
  onAdvanced: () => void;
  onCreated: (experienceId: string) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("America/Denver");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (preview) {
      setError("Preview only — no event was created or invitations sent.");
      return;
    }
    if (!directory.canCreate) return;
    const data = new FormData(event.currentTarget);
    setError(null);
    setPending(true);
    onPendingChange(true);
    try {
      const audience = selectedCircle ? `circle:${selectedCircle.id}` : String(data.get("audience") ?? "");
      const [visibility, audienceId] = audience.split(":");
      if (!["all_members", "circle", "block"].includes(visibility) || (visibility !== "all_members" && !audienceId)) {
        throw new Error("Choose an audience for this event.");
      }
      const timezone = String(data.get("timezone") ?? "America/Denver").trim();
      const startsAt = zonedDateTimeLocalToIso(String(data.get("startsAt") ?? ""), timezone);
      if (!startsAt) throw new Error("Choose the event date and time.");
      const duration = Number(data.get("duration") ?? 60);
      if (![30, 60, 90, 120, 180].includes(duration)) throw new Error("Choose an event duration.");
      const response = await fetch("/api/ops/experiences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: "create_and_publish",
          requestId,
          title: String(data.get("title") ?? ""),
          meetingUrl: String(data.get("meetingUrl") ?? "").trim(),
          visibility,
          circleId: visibility === "circle" ? audienceId : null,
          blockId: visibility === "block" ? audienceId : null,
          startsAt,
          endsAt: new Date(Date.parse(startsAt) + duration * 60_000).toISOString(),
          timezone,
          kind: visibility === "circle" ? "circle_meeting" : "member_event",
          summary: String(data.get("summary") ?? ""),
          details: "",
          locationLabel: "Google Meet",
          registrationMode: "none",
          capacity: null,
          waitlistEnabled: false,
          externalRegistrationUrl: null,
          registrationOpensAt: null,
          registrationClosesAt: null,
        }),
      });
      const payload = await response.json() as { error?: string; experience?: { experienceId?: string } };
      if (!response.ok || !payload.experience?.experienceId) {
        throw new Error(payload.error || "The event could not be created. Your details are still here.");
      }
      setDirty(false);
      onCreated(payload.experience.experienceId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The event could not be created.");
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  }

  return <form id="new-experience" className="mx-auto max-w-2xl space-y-5" data-operator-dirty={dirty ? "true" : undefined} data-operator-pending={pending ? "true" : undefined} onChange={() => { setDirty(true); setRequestId(crypto.randomUUID()); }} onInvalidCapture={(event) => { if (event.target instanceof Element) { const details = event.target.closest("details"); if (details) details.open = true; } }} onSubmit={createEvent}>
    <label className={OPERATOR_LABEL_CLASS}>
      <span className={OPERATOR_LABEL_TEXT_CLASS}>Title</span>
      <input className={OPERATOR_FIELD_CLASS} defaultValue={selectedCircle ? `${selectedCircle.name} meeting` : undefined} maxLength={200} name="title" placeholder="Give the event a name" required />
    </label>
    <label className={OPERATOR_LABEL_CLASS}>
      <span className={OPERATOR_LABEL_TEXT_CLASS}>Google Meet link</span>
      <input autoCapitalize="none" className={OPERATOR_FIELD_CLASS} maxLength={2000} name="meetingUrl" placeholder="https://meet.google.com/abc-defg-hij" required type="url" />
    </label>
    {selectedCircle ? <div>
      <p className={OPERATOR_LABEL_TEXT_CLASS}>Audience</p>
      <p className="mt-2 text-sm font-semibold">{selectedCircle.name}</p>
      <input name="audience" type="hidden" value={`circle:${selectedCircle.id}`} />
    </div> : <label className={OPERATOR_LABEL_CLASS}>
      <span className={OPERATOR_LABEL_TEXT_CLASS}>Audience</span>
      <select className={OPERATOR_FIELD_CLASS} defaultValue={directory.canManageGlobal ? "all_members" : directory.circles[0] ? `circle:${directory.circles[0].id}` : ""} name="audience" required>
        {directory.canManageGlobal ? <option value="all_members">All active members</option> : <option value="" disabled>Choose a Circle</option>}
        {directory.circles.length > 0 ? <optgroup label="Circles">{directory.circles.map((circle) => <option key={circle.id} value={`circle:${circle.id}`}>{circle.name}</option>)}</optgroup> : null}
        {directory.canManageGlobal && directory.blocks.length > 0 ? <optgroup label="Blocks">{directory.blocks.map((block) => <option key={block.id} value={`block:${block.id}`}>{block.name}</option>)}</optgroup> : null}
      </select>
    </label>}
    <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <OperatorDateTimeField label="Date & time" name="startsAt" onChange={() => setDirty(true)} required />
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Duration</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue="60" name="duration">
          <option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1½ hours</option><option value="120">2 hours</option><option value="180">3 hours</option>
        </select>
      </label>
    </div>
    <p className="!mt-2 text-xs text-black/50">Times in {timezone || "your selected time zone"}.</p>
    <details className="text-sm">
      <summary className="min-h-11 cursor-pointer py-3 text-black/60">Time zone & description</summary>
      <div className="space-y-4 pb-2 pt-2">
        <label className={OPERATOR_LABEL_CLASS}><span className={OPERATOR_LABEL_TEXT_CLASS}>Time zone</span><input className={OPERATOR_FIELD_CLASS} name="timezone" onChange={(event) => setTimezone(event.target.value)} required value={timezone} /></label>
        <label className={OPERATOR_LABEL_CLASS}><span className={OPERATOR_LABEL_TEXT_CLASS}>Description (optional)</span><textarea className={`${OPERATOR_FIELD_CLASS} min-h-20 resize-y`} maxLength={2000} name="summary" /></label>
      </div>
    </details>
    {error ? <p className="text-sm text-[var(--color-poster)]" role="alert">{error}</p> : null}
    <div className="space-y-3 border-t border-black/10 pt-5">
      <p className="text-sm text-black/60">Creates the event and sends calendar invitations to this audience. No registration needed.</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button className={`${OPERATOR_PRIMARY_ACTION_CLASS} w-full sm:w-auto`} disabled={pending} type="submit">{pending ? "Creating event…" : "Create event"}</button>
        <button className="min-h-11 text-sm text-black/55 underline underline-offset-4" disabled={pending} onClick={() => {
          if (!dirty || window.confirm("Switch to advanced setup and discard these details?")) onAdvanced();
        }} type="button">Advanced event setup</button>
      </div>
    </div>
  </form>;
}
