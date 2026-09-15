"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import OperatorDialog from "@/components/platform/OperatorDialog";
import OperatorDateTimeField from "@/components/platform/OperatorDateTimeField";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import {
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
  OPERATOR_PRIMARY_ACTION_CLASS,
} from "@/components/platform/operatorStyles";
import { zonedDateTimeLocalToIso } from "@/lib/datetime/zoned-date-time";
import type { OpsExperienceDirectory } from "@/lib/platform/ops-experience-model";

function formatDate(value: string | null): string {
  if (!value) return "Schedule not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Schedule not set";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

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

export default function OperatorExperienceDirectory({
  directory,
  navigation,
  requestedCircleId,
  preview = false,
}: {
  directory: OpsExperienceDirectory;
  navigation?: ReactNode;
  requestedCircleId?: string;
  preview?: boolean;
}) {
  const router = useRouter();
  const selectedCircle = directory.circles.find((circle) => circle.id === requestedCircleId);
  const invalidCircle = requestedCircleId !== undefined && !selectedCircle;
  const experiences = invalidCircle ? [] : selectedCircle
    ? directory.experiences.filter((experience) => experience.circleId === selectedCircle.id)
    : directory.experiences;
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const visibleExperiences = experiences.filter((experience) =>
    (stateFilter === "all" || experience.state === stateFilter)
    && `${experience.title} ${experience.scope} ${experience.kind}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [newRegistrationMode, setNewRegistrationMode] = useState<"external" | "internal" | "none">(selectedCircle ? "none" : "internal");
  const [newVisibility, setNewVisibility] = useState<"all_members" | "block" | "circle" | "invite_only" | "public">(
    selectedCircle || !directory.canManageGlobal ? "circle" : "all_members",
  );

  useEffect(() => {
    // Existing Circle and dashboard links can still open the creation task directly.
    const openFromHash = () => {
      if (window.location.hash === "#new-experience" && directory.canCreate && !invalidCircle) {
        setCreateOpen(true);
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("popstate", openFromHash);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      window.removeEventListener("popstate", openFromHash);
    };
  }, [directory.canCreate, invalidCircle, requestedCircleId]);

  function openCreate() {
    setCreateOpen(true);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#new-experience`);
  }

  function closeCreate() {
    if (pending) return;
    setCreateOpen(false);
    setDirty(false);
    setError(null);
    setFormVersion((version) => version + 1);
    setNewRegistrationMode(selectedCircle ? "none" : "internal");
    setNewVisibility(selectedCircle || !directory.canManageGlobal ? "circle" : "all_members");
    if (window.location.hash === "#new-experience") {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
  }

  async function createExperience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (invalidCircle || !directory.canCreate) {
      setError("Choose a Circle you can manage before scheduling a meeting.");
      return;
    }
    if (preview) {
      setError("Preview only — this draft was not saved.");
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const visibility = selectedCircle ? "circle" : String(data.get("visibility") ?? "all_members");
    const registrationMode = selectedCircle ? "none" : String(data.get("registrationMode") ?? "none");
    const capacityValue = String(data.get("capacity") ?? "").trim();
    const timezone = String(data.get("timezone") ?? "America/Denver").trim();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/experiences", {
        body: JSON.stringify({
          blockId: visibility === "block" ? String(data.get("blockId") ?? "") || null : null,
          capacity: registrationMode === "internal" && capacityValue ? Number(capacityValue) : null,
          circleId: selectedCircle?.id ?? (visibility === "circle" ? String(data.get("circleId") ?? "") || null : null),
          details: String(data.get("details") ?? ""),
          endsAt: zonedDateTimeLocalToIso(String(data.get("endsAt") ?? ""), timezone),
          externalRegistrationUrl: registrationMode === "external"
            ? String(data.get("externalRegistrationUrl") ?? "") || null
            : null,
          kind: selectedCircle ? "circle_meeting" : String(data.get("kind") ?? "member_event"),
          locationLabel: String(data.get("locationLabel") ?? ""),
          registrationClosesAt: registrationMode === "internal"
            ? zonedDateTimeLocalToIso(String(data.get("registrationClosesAt") ?? ""), timezone)
            : null,
          registrationMode,
          registrationOpensAt: registrationMode === "internal"
            ? zonedDateTimeLocalToIso(String(data.get("registrationOpensAt") ?? ""), timezone)
            : null,
          startsAt: zonedDateTimeLocalToIso(String(data.get("startsAt") ?? ""), timezone) ?? "",
          summary: String(data.get("summary") ?? ""),
          timezone,
          title: String(data.get("title") ?? ""),
          visibility,
          waitlistEnabled: registrationMode === "internal" && data.get("waitlistEnabled") === "on",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        experience?: { experienceId?: string };
      };
      if (!response.ok || !payload.experience?.experienceId) {
        throw new Error(payload.error || "The Experience draft could not be created.");
      }
      form.reset();
      setDirty(false);
      router.push(`/ops/experiences/${payload.experience.experienceId}${selectedCircle ? "#meeting-setup" : ""}`);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The Experience draft could not be created.");
    } finally {
      setPending(false);
    }
  }

  if (invalidCircle) return (
    <OperatorPageFrame title="Circle meetings">
      {navigation}
      <p role="alert" className="mb-4 text-[var(--color-poster)]">This Circle is unavailable or you do not have permission to schedule for it. No other audience has been selected.</p>
      <div className="flex flex-wrap gap-4 text-sm font-semibold"><Link href="/ops/circles">Choose a Circle →</Link><Link href="/ops/experiences">All member experiences →</Link></div>
    </OperatorPageFrame>
  );

  return (
    <OperatorPageFrame title="Experiences">
      {navigation}
      {selectedCircle ? <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="operator-compact-label">Circle meetings</p><h2 className="operator-page-heading">{selectedCircle.name}</h2></div>
        <Link className="text-sm underline underline-offset-4" href={`/ops/circles?circleId=${selectedCircle.id}#circle-communications`}>Back to chat & meetings →</Link>
      </div> : null}
      <section className="space-y-3" aria-label="Experience directory">
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <label className="min-w-40 flex-1">
            <span className="sr-only">Find an Experience</span>
            <input className={`${OPERATOR_FIELD_CLASS} !mt-0`} onChange={(event) => setQuery(event.target.value)} placeholder="Search experiences" type="search" value={query} />
          </label>
          <label className="w-36 sm:w-40">
            <span className="sr-only">Show Experiences</span>
            <select className={`${OPERATOR_FIELD_CLASS} !mt-0`} onChange={(event) => setStateFilter(event.target.value)} value={stateFilter}>
              <option value="all">All statuses</option>
              {["draft", "published", "completed", "cancelled", "archived"].map((state) => <option key={state} value={state}>{state[0].toUpperCase() + state.slice(1)}</option>)}
            </select>
          </label>
          {directory.canCreate ? <button className={`${OPERATOR_PRIMARY_ACTION_CLASS} w-full sm:w-auto`} id="new-experience-trigger" onClick={openCreate} type="button">{selectedCircle ? "+ Schedule a meeting" : "+ New experience"}</button> : null}
        </div>
        <p className="pb-1 text-sm text-black/50" aria-live="polite">{visibleExperiences.length} {visibleExperiences.length === 1 ? "experience" : "experiences"}{stateFilter !== "all" || query.trim() ? ` of ${experiences.length}` : ""}</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleExperiences.map((experience) => (
          <article
            id={`experience-${experience.experienceId}`}
            key={experience.experienceId}
          >
            <Link className="operator-bento-card group flex h-full flex-col gap-3 transition-colors hover:!bg-white/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black" href={`/ops/experiences/${experience.experienceId}`}>
              <div className="min-w-0">
                <p className="text-sm text-black/55">{formatDate(experience.startsAt)}</p>
                <h2 className="operator-section-heading mt-2 break-words">{experience.title}</h2>
                <p className="mt-2 text-xs text-black/55">{experience.scope}</p>
              </div>
              <span className="self-start"><StateLabel state={experience.state} /></span>
              <div className="mt-auto flex items-center justify-between gap-3 text-xs text-black/55">
                <p><span className="tabular-nums">{experience.registeredCount}{experience.capacity ? ` / ${experience.capacity}` : ""}</span> confirmed{experience.waitlistedCount ? <span className="block sm:mt-1">{experience.waitlistedCount} waiting</span> : null}</p>
                <span aria-hidden="true" className="text-xl text-black/55 transition-transform group-hover:translate-x-0.5">→</span>
              </div>
            </Link>
          </article>
        ))}
        </div>
        {visibleExperiences.length === 0 ? (
          <p className="rounded-[4px] bg-black/[0.035] px-5 py-10 text-sm text-black/50">
            {experiences.length ? "No matches. Try another search or choose All statuses." : !directory.canCreate ? "No experiences are available in your assigned scope." : selectedCircle ? "No meetings yet. Choose Schedule a meeting to get started." : "No experiences yet. Choose New experience to get started."}
          </p>
        ) : null}
      </section>

      {directory.canCreate ? (
        <OperatorDialog open={createOpen} title={selectedCircle ? "Schedule a meeting" : "New experience"} context={selectedCircle ? <span className="text-sm text-black/60">{selectedCircle.name}</span> : undefined} onClose={closeCreate} pending={pending} returnFocusId="new-experience-trigger">
          <form key={formVersion} id="new-experience" className="space-y-6" data-operator-dirty={dirty ? "true" : undefined} data-operator-pending={pending ? "true" : undefined} onChange={() => setDirty(true)} onInvalidCapture={(event) => { if (event.target instanceof Element) { const details = event.target.closest("details"); if (details) details.open = true; } }} onSubmit={createExperience}>
            <FormField label={selectedCircle ? "Meeting title" : "Title"}>
              <input className={OPERATOR_FIELD_CLASS} maxLength={200} name="title" defaultValue={selectedCircle ? `${selectedCircle.name} meeting` : undefined} required />
            </FormField>
            <fieldset className="min-w-0">
              <legend className="mb-3 font-[var(--font-display)] text-2xl">When</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <OperatorDateTimeField label="Starts" name="startsAt" onChange={() => setDirty(true)} required />
                <OperatorDateTimeField label="Ends (optional)" name="endsAt" onChange={() => setDirty(true)} />
                <FormField className="sm:col-span-2" label="Time zone">
                  <input className={OPERATOR_FIELD_CLASS} defaultValue="America/Denver" name="timezone" required />
                </FormField>
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-3 font-[var(--font-display)] text-2xl">Who</legend>
              {selectedCircle ? <><p className="font-semibold">{selectedCircle.name}</p><p className="mt-1 text-sm text-black/55">Eligible Circle members are invited. No reservation needed.</p><input name="kind" type="hidden" value="circle_meeting" /><input name="visibility" type="hidden" value="circle" /><input name="circleId" type="hidden" value={selectedCircle.id} /></> : <div className="grid gap-4 sm:grid-cols-2">
                {directory.canManageGlobal ? <FormField label="Audience">
                  <select className={OPERATOR_FIELD_CLASS} name="visibility" onChange={(event) => setNewVisibility(event.target.value as typeof newVisibility)} value={newVisibility}>
                    <option value="all_members">All active members</option>
                    <option value="public">Public</option>
                    <option value="invite_only">Invite only</option>
                    {directory.circles.length > 0 ? <option value="circle">Circle</option> : null}
                    {directory.blocks.length > 0 ? <option value="block">Block</option> : null}
                  </select>
                </FormField> : <><input name="kind" type="hidden" value="circle_meeting" /><input name="visibility" type="hidden" value="circle" /></>}
                {newVisibility === "circle" && directory.circles.length > 0 ? <FormField label="Circle">
                  <select className={OPERATOR_FIELD_CLASS} defaultValue={directory.circles[0]?.id} name="circleId" required>{directory.circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}</select>
                </FormField> : null}
                {newVisibility === "block" && directory.blocks.length > 0 ? <FormField label="Block">
                  <select className={OPERATOR_FIELD_CLASS} defaultValue={directory.blocks[0]?.id} name="blockId" required>{directory.blocks.map((block) => <option key={block.id} value={block.id}>{block.name}</option>)}</select>
                </FormField> : null}
              </div>}
            </fieldset>
            <FormField label="Where (optional)">
              <input className={OPERATOR_FIELD_CLASS} maxLength={500} name="locationLabel" placeholder="Online or a place name" />
            </FormField>
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[4px] bg-black/[0.035] px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"><span>Description & options</span><span className="group-open:rotate-45" aria-hidden="true">+</span></summary>
              <div className="grid gap-4 pt-5 sm:grid-cols-2">
                <FormField className="sm:col-span-2" label="Short summary"><textarea className={`${OPERATOR_FIELD_CLASS} min-h-20 resize-y`} maxLength={2000} name="summary" /></FormField>
                <FormField className="sm:col-span-2" label="Full details"><textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} maxLength={20000} name="details" /></FormField>
                {!selectedCircle && directory.canManageGlobal ? <FormField label="Type">
                  <select className={OPERATOR_FIELD_CLASS} defaultValue="member_event" name="kind">
                    <option value="member_event">Member event</option><option value="circle_meeting">Circle meeting</option><option value="weekly_call">Weekly call</option><option value="public_event">Public event</option><option value="academy_session">Academy session</option><option value="challenge">Challenge</option><option value="retreat">Retreat</option>
                  </select>
                </FormField> : null}
                {selectedCircle ? <input name="registrationMode" type="hidden" value="none" /> : <FormField label="Registration">
                  <select className={OPERATOR_FIELD_CLASS} name="registrationMode" onChange={(event) => setNewRegistrationMode(event.target.value as typeof newRegistrationMode)} value={newRegistrationMode}>
                    <option value="internal">Members reserve a place</option><option value="none">No reservation needed</option><option value="external">Register on another website</option>
                  </select>
                </FormField>}
                {newRegistrationMode === "internal" ? <>
                  <FormField label="Capacity"><input className={OPERATOR_FIELD_CLASS} min={1} name="capacity" placeholder="Unlimited" type="number" /></FormField>
                  <label className="flex min-h-12 items-center gap-3 self-end text-sm text-black/60"><input defaultChecked name="waitlistEnabled" type="checkbox" />Start a waitlist when full</label>
                  <FormField label="Registration opens"><input className={`${OPERATOR_FIELD_CLASS} min-w-0`} name="registrationOpensAt" type="datetime-local" /></FormField>
                  <FormField label="Registration closes"><input className={`${OPERATOR_FIELD_CLASS} min-w-0`} name="registrationClosesAt" type="datetime-local" /></FormField>
                </> : null}
                {newRegistrationMode === "external" ? <FormField className="sm:col-span-2" label="Registration website"><input className={OPERATOR_FIELD_CLASS} name="externalRegistrationUrl" placeholder="https://" required type="url" /></FormField> : null}
              </div>
            </details>
            {!selectedCircle ? <p className="text-sm text-black/55">{newRegistrationMode === "internal" ? "Members will reserve a place before receiving a Calendar invitation." : newRegistrationMode === "external" ? "Members register on the website you provide." : "Eligible members in this audience can receive Calendar invitations without reserving a place."}</p> : null}
            {error ? <p aria-live="assertive" className="text-sm text-[var(--color-poster)]" role="alert">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={pending} type="submit">
                {pending ? "Saving…" : "Save draft & continue"}
              </button>
              <p className="text-sm text-black/55">Nothing is published or sent yet.</p>
            </div>
          </form>
        </OperatorDialog>
      ) : null}

    </OperatorPageFrame>
  );
}
