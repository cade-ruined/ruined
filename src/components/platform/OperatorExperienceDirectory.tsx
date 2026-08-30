"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";

import OperatorGoogleCommunicationField from "@/components/platform/OperatorGoogleCommunicationField";
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
  preview = false,
}: {
  directory: OpsExperienceDirectory;
  preview?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [newRegistrationMode, setNewRegistrationMode] = useState<"external" | "internal" | "none">("internal");
  const [newVisibility, setNewVisibility] = useState<"all_members" | "block" | "circle" | "invite_only" | "public">(
    directory.canManageGlobal ? "all_members" : "circle",
  );
  const registeredCount = directory.experiences.reduce(
    (total, experience) => total + experience.registeredCount,
    0,
  );
  const waitlistedCount = directory.experiences.reduce(
    (total, experience) => total + experience.waitlistedCount,
    0,
  );

  async function createExperience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (preview) {
      setError("Preview only — this draft was not saved.");
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const visibility = String(data.get("visibility") ?? "all_members");
    const registrationMode = String(data.get("registrationMode") ?? "none");
    const capacityValue = String(data.get("capacity") ?? "").trim();
    const timezone = String(data.get("timezone") ?? "America/Denver").trim();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/experiences", {
        body: JSON.stringify({
          blockId: visibility === "block" ? String(data.get("blockId") ?? "") || null : null,
          capacity: registrationMode === "internal" && capacityValue ? Number(capacityValue) : null,
          circleId: visibility === "circle" ? String(data.get("circleId") ?? "") || null : null,
          details: String(data.get("details") ?? ""),
          endsAt: zonedDateTimeLocalToIso(String(data.get("endsAt") ?? ""), timezone),
          externalRegistrationUrl: registrationMode === "external"
            ? String(data.get("externalRegistrationUrl") ?? "") || null
            : null,
          kind: String(data.get("kind") ?? "member_event"),
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
          waitlistEnabled: data.get("waitlistEnabled") === "on",
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
      router.push(`/ops/experiences/${payload.experience.experienceId}`);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The Experience draft could not be created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <OperatorPageFrame title="Experiences">
      <dl
        aria-label="Experience snapshot"
        className="grid gap-6 rounded-[4px] bg-[#080605] px-6 py-6 text-[var(--color-bone)] sm:grid-cols-4 sm:px-8 sm:py-8"
      >
        {[
          ["Experiences", directory.experiences.length],
          ["Confirmed", registeredCount],
          ["Waitlisted", waitlistedCount],
          ["Drafts", directory.experiences.filter((item) => item.state === "draft").length],
        ].map(([name, value]) => (
          <div key={name}>
            <dt className="text-sm text-white/48">{name}</dt>
            <dd className="mt-2 font-[var(--font-display)] text-4xl leading-none tracking-[-0.03em] sm:text-5xl">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {directory.canCreate ? (
        <details
          className={`group mt-6 rounded-[4px] bg-[var(--color-highlight)] ${directory.experiences.length === 0 ? "shadow-[5px_5px_0_#080605]" : ""}`}
          open={directory.experiences.length === 0}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 marker:content-none sm:px-6">
            <span className="font-[var(--font-display)] text-2xl leading-none">Add an Experience</span>
            <span aria-hidden="true" className="text-2xl transition-transform group-open:rotate-45">+</span>
          </summary>
          <form className="grid gap-4 bg-white/35 px-5 pb-6 pt-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4" onSubmit={createExperience}>
            <FormField className="sm:col-span-2" label="Title">
              <input className={OPERATOR_FIELD_CLASS} maxLength={200} name="title" required />
            </FormField>
            {directory.canManageGlobal ? (
              <>
                <FormField label="Type">
                  <select className={OPERATOR_FIELD_CLASS} defaultValue="member_event" name="kind">
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
                    onChange={(event) => setNewVisibility(event.target.value as typeof newVisibility)}
                    value={newVisibility}
                  >
                    <option value="all_members">All active members</option>
                    <option value="public">Public</option>
                    <option value="invite_only">Invite only</option>
                    {directory.circles.length > 0 ? <option value="circle">Circle</option> : null}
                    {directory.blocks.length > 0 ? <option value="block">Block</option> : null}
                  </select>
                </FormField>
              </>
            ) : (
              <>
                <input name="kind" type="hidden" value="circle_meeting" />
                <input name="visibility" type="hidden" value="circle" />
              </>
            )}
            {newVisibility === "circle" && directory.circles.length > 0 ? (
              <FormField label="Circle">
                <select className={OPERATOR_FIELD_CLASS} defaultValue={directory.circles[0]?.id} name="circleId" required>
                  {directory.circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
                </select>
              </FormField>
            ) : null}
            {newVisibility === "block" && directory.blocks.length > 0 ? (
              <FormField label="Block">
                <select className={OPERATOR_FIELD_CLASS} defaultValue={directory.blocks[0]?.id} name="blockId" required>
                  {directory.blocks.map((block) => <option key={block.id} value={block.id}>{block.name}</option>)}
                </select>
              </FormField>
            ) : null}
            <FormField label="Starts">
              <input className={OPERATOR_FIELD_CLASS} name="startsAt" required type="datetime-local" />
            </FormField>
            <FormField label="Ends">
              <input className={OPERATOR_FIELD_CLASS} name="endsAt" type="datetime-local" />
            </FormField>
            <FormField label="Timezone">
              <input className={OPERATOR_FIELD_CLASS} defaultValue="America/Denver" name="timezone" required />
            </FormField>
            <FormField label="Place">
              <input className={OPERATOR_FIELD_CLASS} maxLength={500} name="locationLabel" />
            </FormField>
            <FormField label="Registration">
              <select
                className={OPERATOR_FIELD_CLASS}
                name="registrationMode"
                onChange={(event) => setNewRegistrationMode(event.target.value as typeof newRegistrationMode)}
                value={newRegistrationMode}
              >
                <option value="internal">Managed here</option>
                <option value="none">No reservation</option>
                <option value="external">External link</option>
              </select>
            </FormField>
            {newRegistrationMode === "internal" ? (
              <>
                <FormField label="Capacity">
                  <input className={OPERATOR_FIELD_CLASS} min={1} name="capacity" placeholder="Unlimited" type="number" />
                </FormField>
                <FormField label="Registration opens">
                  <input className={OPERATOR_FIELD_CLASS} name="registrationOpensAt" type="datetime-local" />
                </FormField>
                <FormField label="Registration closes">
                  <input className={OPERATOR_FIELD_CLASS} name="registrationClosesAt" type="datetime-local" />
                </FormField>
                <label className="flex min-h-12 items-center gap-3 self-end text-sm text-black/60">
                  <input defaultChecked name="waitlistEnabled" type="checkbox" />
                  Start a waitlist when capacity is reached
                </label>
              </>
            ) : null}
            {newRegistrationMode === "external" ? (
              <FormField className="sm:col-span-2" label="External registration link">
                <input className={OPERATOR_FIELD_CLASS} name="externalRegistrationUrl" placeholder="https://" required type="url" />
              </FormField>
            ) : null}
            <FormField className="sm:col-span-2" label="Short summary">
              <textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} maxLength={2000} name="summary" />
            </FormField>
            <FormField className="sm:col-span-2" label="Full details">
              <textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} maxLength={20000} name="details" />
            </FormField>
            <div className="flex items-center gap-4 sm:col-span-2">
              <button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={pending} type="submit">
                {pending ? "Saving" : "Save draft"}
              </button>
              {error ? <p aria-live="assertive" className="text-sm text-[var(--color-poster)]" role="alert">{error}</p> : null}
            </div>
          </form>
        </details>
      ) : null}

      <section className="mt-8 space-y-3" aria-label="Experience directory">
        {directory.experiences.map((experience) => (
          <article
            className="grid gap-5 rounded-[4px] bg-black/[0.035] px-5 py-6 transition-colors hover:bg-black/[0.06] sm:px-6 xl:grid-cols-[minmax(15rem,1fr)_12rem_9rem_7rem] xl:items-center min-[1400px]:grid-cols-[minmax(15rem,1fr)_12rem_9rem_7rem_minmax(14rem,0.8fr)]"
            id={`experience-${experience.experienceId}`}
            key={experience.experienceId}
          >
            <div>
              <p className="text-sm capitalize text-black/45">
                {experience.kind.replaceAll("_", " ")} · {experience.scope}
              </p>
              <h2 className="mt-2 text-3xl leading-none tracking-[-0.025em]">
                <Link className="hover:text-[var(--color-poster)]" href={`/ops/experiences/${experience.experienceId}`}>
                  {experience.title}
                </Link>
              </h2>
            </div>
            <div className="text-sm leading-relaxed text-black/55">
              <p>{formatDate(experience.startsAt)}</p>
              {experience.endsAt ? <p className="mt-1 text-black/38">Ends {formatDate(experience.endsAt)}</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-2xl tabular-nums">{experience.registeredCount}</p><p className="text-black/42">Confirmed</p></div>
              <div><p className="text-2xl tabular-nums">{experience.waitlistedCount}</p><p className="text-black/42">Waiting</p></div>
              {experience.capacity ? <p className="col-span-2 text-xs text-black/42">Capacity {experience.capacity}</p> : null}
            </div>
            <StateLabel state={experience.state} />
            <div className="xl:col-span-4 min-[1400px]:col-span-1">
              <OperatorGoogleCommunicationField
                configured={experience.googleCommunicationsConfigured}
                editable
                entityId={experience.experienceId}
                entityType="experience"
                initialUrl={experience.meetingUrl}
                kind="meet"
                preview={preview}
              />
            </div>
          </article>
        ))}
        {directory.experiences.length === 0 ? (
          <p className="rounded-[4px] bg-black/[0.035] px-5 py-10 text-sm text-black/50">
            No Experiences are visible to this operator.
          </p>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
