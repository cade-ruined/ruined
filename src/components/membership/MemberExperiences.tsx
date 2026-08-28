"use client";

import Link from "next/link";
import { useState } from "react";

import MemberPageHeader, {
  MemberEmptyRoom,
} from "@/components/membership/MemberPageHeader";
import type {
  MemberExperienceSummary,
  MemberExperiencesSnapshot,
} from "@/lib/membership/model";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    weekday: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function ExperienceRow({
  experience,
  onRegistrationChange,
  writable,
}: {
  experience: MemberExperienceSummary;
  onRegistrationChange: (
    id: string,
    state: MemberExperienceSummary["registrationState"],
  ) => void;
  writable: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCancel =
    experience.registrationState === "registered" ||
    experience.registrationState === "waitlisted";
  const registrationLeavesRuined = Boolean(
    experience.registrationHref
    && !experience.registrationHref.startsWith("/"),
  );

  async function changeRegistration(action: "cancel" | "register") {
    if (!writable || pending || !experience.registrationHref) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(experience.registrationHref, {
        body: JSON.stringify({ action }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        registration?: { status?: MemberExperienceSummary["registrationState"] };
      };
      if (!response.ok || !payload.registration?.status) {
        throw new Error(payload.error || "Registration could not be saved.");
      }
      onRegistrationChange(experience.id, payload.registration.status);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Registration could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="grid gap-6 border-b border-black/20 py-9 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start sm:gap-8 sm:py-11" id={`experience-${experience.id}`}>
      <div>
        <time className="font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.14em] text-black/46">
          {formatDate(experience.startsAt)}
        </time>
        <p className="mt-2 font-[var(--font-body)] text-xs text-black/36">
          {formatTime(experience.startsAt)}
        </p>
      </div>
      <div>
        <p className="font-[var(--font-body)] text-[0.62rem] uppercase tracking-[0.15em] text-[var(--color-poster)]">
          {experience.audienceLabel} / {experience.kind.replaceAll("_", " ")}
        </p>
        <h3 className="mt-4 font-[var(--font-display)] text-4xl leading-[0.94] tracking-[-0.035em] sm:text-5xl">
          <Link className="transition-colors hover:text-[var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]" href={experience.detailHref}>
            {experience.title} <span aria-hidden="true">→</span>
          </Link>
        </h3>
        {experience.summary ? (
          <p className="mt-5 max-w-2xl font-[var(--font-body)] text-sm leading-relaxed text-black/54 sm:text-base">
            {experience.summary}
          </p>
        ) : null}
        {experience.locationLabel ? (
          <p className="mt-5 font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/38">
            {experience.locationLabel}
          </p>
        ) : null}
        {error ? (
          <p aria-live="polite" className="mt-5 border-l-2 border-[var(--color-poster)] pl-4 font-[var(--font-body)] text-sm text-black/58">
            {error}
          </p>
        ) : null}
      </div>
      <div className="sm:text-right">
        {experience.registrationState === "external" && experience.registrationHref ? (
          <a
            className="inline-flex min-h-11 items-center border border-black px-5 font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.14em] transition-colors hover:bg-black hover:text-white"
            href={experience.registrationHref}
            rel={registrationLeavesRuined ? "noreferrer" : undefined}
            target={registrationLeavesRuined ? "_blank" : undefined}
          >
            Register ↗
          </a>
        ) : experience.registrationHref ? (
          <button
            className="inline-flex min-h-11 items-center border border-black px-5 font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.14em] transition-colors hover:bg-black hover:text-white disabled:cursor-wait disabled:opacity-45"
            disabled={!writable || pending}
            onClick={() => changeRegistration(canCancel ? "cancel" : "register")}
            type="button"
          >
            {pending
              ? "Saving"
              : canCancel
                ? experience.registrationState === "waitlisted"
                  ? "Leave waitlist"
                  : "Cancel place"
                : "Reserve place"}
          </button>
        ) : (
          <span className="font-[var(--font-body)] text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/38">
            {experience.registrationState === "registered"
              ? "Place held"
              : experience.registrationState === "closed"
                ? "Registration closed"
                : "No registration"}
          </span>
        )}
      </div>
    </li>
  );
}

export default function MemberExperiences({
  initialExperiences,
  writable,
}: {
  initialExperiences: MemberExperiencesSnapshot;
  writable: boolean;
}) {
  const [experiences, setExperiences] = useState(initialExperiences);

  function updateRegistration(
    id: string,
    registrationState: MemberExperienceSummary["registrationState"],
  ) {
    const update = (experience: MemberExperienceSummary) =>
      experience.id === id ? { ...experience, registrationState } : experience;
    setExperiences((current) => ({
      ...current,
      past: current.past.map(update),
      upcoming: current.upcoming.map(update),
    }));
  }

  return (
    <main>
      <MemberPageHeader
        eyebrow="Ruined Membership / Experiences"
        imageIntent="An empty long table just before a gathering. Linen, black chairs, unforced light."
        imageSequence="03"
        note="show up where it matters"
        summary="Circle rooms, member gatherings, weekly calls, challenges, and the public Ruined experiences available to you."
        title="The calendar is a choice."
      />

      <section className="mt-20" aria-labelledby="upcoming-experiences-title">
        <div className="border-b border-black/20 pb-8">
          <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">
            Next
          </p>
          <h2 className="mt-4 font-[var(--font-display)] text-5xl leading-none tracking-[-0.04em] sm:text-6xl" id="upcoming-experiences-title">
            Upcoming experiences.
          </h2>
        </div>
        {experiences.upcoming.length ? (
          <ol>
            {experiences.upcoming.map((experience) => (
              <ExperienceRow
                experience={experience}
                key={experience.id}
                onRegistrationChange={updateRegistration}
                writable={writable}
              />
            ))}
          </ol>
        ) : (
          <MemberEmptyRoom
            body="Published Circle meetings and member experiences will appear here when there is something worth showing up for."
            title="Nothing is scheduled yet."
          />
        )}
      </section>

      <section className="mt-20" aria-labelledby="past-experiences-title">
        <div className="border-b border-black/20 pb-7">
          <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-black/38">
            Record
          </p>
          <h2 className="mt-4 font-[var(--font-display)] text-4xl leading-none tracking-[-0.035em] sm:text-5xl" id="past-experiences-title">
            What already happened.
          </h2>
        </div>
        {experiences.past.length ? (
          <ol>
            {experiences.past.map((experience) => (
              <ExperienceRow
                experience={experience}
                key={experience.id}
                onRegistrationChange={updateRegistration}
                writable={false}
              />
            ))}
          </ol>
        ) : (
          <p className="border-b border-black/20 py-9 font-[var(--font-body)] text-sm leading-relaxed text-black/45">
            Your member experience archive begins after the first published gathering.
          </p>
        )}
      </section>
    </main>
  );
}
