"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EVENTS, type StudioEvent } from "@/data/events";
import type {
  MemberExperienceSummary,
  MemberExperiencesSnapshot,
} from "@/lib/membership/model";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type CalendarMonth = {
  month: number;
  year: number;
};

type CalendarDay = {
  day: number;
  month: number;
  year: number;
};

function dateParts(value: string, timezone: string): CalendarDay {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "numeric",
      timeZone: timezone,
      year: "numeric",
    }).formatToParts(new Date(value));
    return {
      day: Number(parts.find((part) => part.type === "day")?.value ?? 1),
      month: Number(parts.find((part) => part.type === "month")?.value ?? 1) - 1,
      year: Number(parts.find((part) => part.type === "year")?.value ?? 1970),
    };
  } catch {
    const date = new Date(value);
    return {
      day: date.getUTCDate(),
      month: date.getUTCMonth(),
      year: date.getUTCFullYear(),
    };
  }
}

function monthForExperience(experience: MemberExperienceSummary): CalendarMonth {
  const parts = dateParts(experience.startsAt, experience.timezone);
  return { month: parts.month, year: parts.year };
}

function monthKey(month: CalendarMonth) {
  return `${month.year}-${month.month}`;
}

function dayKey(day: CalendarDay) {
  return `${day.year}-${day.month}-${day.day}`;
}

function shiftMonth(month: CalendarMonth, amount: number): CalendarMonth {
  const date = new Date(Date.UTC(month.year, month.month + amount, 1));
  return { month: date.getUTCMonth(), year: date.getUTCFullYear() };
}

function monthLabel(month: CalendarMonth) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(month.year, month.month, 1)));
}

function calendarWeeks(month: CalendarMonth): Array<Array<number | null>> {
  const firstWeekday = new Date(Date.UTC(month.year, month.month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  const cellCount = Math.max(35, Math.ceil((firstWeekday + daysInMonth) / 7) * 7);
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  return Array.from({ length: cellCount / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}

function formatDate(value: string, timezone: string) {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
  };
  try {
    return new Intl.DateTimeFormat("en-US", options).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "long",
      weekday: "long",
      year: "numeric",
    }).format(new Date(value));
  }
}

function formatTime(value: string, timezone: string) {
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", options).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(value));
  }
}

function formatTimeRange(experience: MemberExperienceSummary) {
  const starts = formatTime(experience.startsAt, experience.timezone);
  if (!experience.endsAt) return starts;
  return `${starts} — ${formatTime(experience.endsAt, experience.timezone)}`;
}

function calendarDateLabel(day: CalendarDay) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(day.year, day.month, day.day)));
}

function publicEventFor(experience: MemberExperienceSummary): StudioEvent | null {
  if (!experience.detailHref.startsWith("/community#")) return null;
  const id = decodeURIComponent(experience.detailHref.slice("/community#".length));
  return EVENTS.find((event) => event.id === id) ?? null;
}

function markerClass(experience: MemberExperienceSummary) {
  if (experience.kind.includes("circle")) return "bg-[var(--color-shop)]";
  if (experience.audienceLabel.toLowerCase().includes("block")) return "bg-[var(--color-workwear)]";
  if (experience.kind.includes("public")) return "bg-[var(--color-highlight)]";
  return "bg-[var(--color-verdigris)]";
}

function posterClass(experience: MemberExperienceSummary) {
  if (experience.kind.includes("circle")) return "bg-[var(--color-shop)] text-[#171411]";
  if (experience.audienceLabel.toLowerCase().includes("block")) return "bg-[var(--color-workwear)] text-[#171411]";
  if (experience.kind.includes("public")) return "bg-[var(--color-highlight)] text-[#171411]";
  return "bg-[var(--color-verdigris)] text-[var(--color-bone)]";
}

function registrationLabel(state: MemberExperienceSummary["registrationState"]) {
  switch (state) {
    case "available": return "Registration open";
    case "cancelled": return "Place cancelled";
    case "closed": return "Registration closed";
    case "external": return "External registration";
    case "registered": return "Place held";
    case "waitlisted": return "Waitlisted";
    default: return "No reservation needed";
  }
}

function EventArtwork({ experience }: { experience: MemberExperienceSummary }) {
  const publicEvent = publicEventFor(experience);
  const parts = dateParts(experience.startsAt, experience.timezone);
  const stamp = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: experience.timezone,
  }).format(new Date(experience.startsAt));

  if (publicEvent?.video) {
    return (
      <div className="relative overflow-hidden rounded-[4px] bg-black">
        <video
          aria-label={`${experience.title} recap video`}
          className="mx-auto block aspect-[4/3] max-h-[42rem] w-full object-cover"
          controls
          playsInline
          poster={publicEvent.videoPoster}
          preload="metadata"
        >
          <source src={publicEvent.video} type="video/mp4" />
          Your browser does not support embedded video.
        </video>
      </div>
    );
  }

  if (publicEvent?.image) {
    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-[4px] bg-black">
        <Image
          alt={publicEvent.gallery?.[0]?.alt ?? `${experience.title} event artwork`}
          className="object-cover saturate-[0.88] contrast-[1.03]"
          fill
          sizes="(min-width: 1024px) 52vw, 100vw"
          src={publicEvent.image}
        />
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
        <span className="absolute inset-x-4 top-4 flex items-center justify-between font-[var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.06em] text-white/78 sm:inset-x-5 sm:top-5">
          <span>{stamp}</span>
          <span>{experience.audienceLabel}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`relative flex aspect-[4/3] min-h-[16rem] flex-col justify-between overflow-hidden rounded-[4px] p-5 sm:p-7 ${posterClass(experience)}`} data-experience-poster>
      <div className="flex items-start justify-between gap-4 font-[var(--font-body)] text-[0.6rem] font-black uppercase tracking-[0.055em] opacity-65">
        <span>{experience.audienceLabel}</span>
        <span>{String(parts.day).padStart(2, "0")}</span>
      </div>
      <div>
        <p className="[font-family:var(--font-cadehandy2)] text-2xl leading-none opacity-72">{stamp}</p>
        <p className="ui-heading mt-3 max-w-[14ch] text-[clamp(2.25rem,5vw,4.8rem)] font-black uppercase leading-[0.82] tracking-[-0.055em]">
          {experience.title}
        </p>
      </div>
    </div>
  );
}

export default function MemberExperiences({
  initialExperiences,
  writable,
}: {
  initialExperiences: MemberExperiencesSnapshot;
  writable: boolean;
}) {
  const defaultExperience = initialExperiences.upcoming[0] ?? initialExperiences.past[0] ?? null;
  const [experiences, setExperiences] = useState(initialExperiences);
  const [selectedId, setSelectedId] = useState<string | null>(defaultExperience?.id ?? null);
  const [calendarMonth, setCalendarMonth] = useState<CalendarMonth>(() =>
    defaultExperience
      ? monthForExperience(defaultExperience)
      : { month: new Date().getMonth(), year: new Date().getFullYear() },
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allExperiences = useMemo(
    () => [...experiences.upcoming, ...experiences.past]
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)),
    [experiences],
  );
  const selected = allExperiences.find((experience) => experience.id === selectedId) ?? null;
  const pastIds = useMemo(() => new Set(experiences.past.map((experience) => experience.id)), [experiences.past]);
  const monthExperiences = allExperiences.filter(
    (experience) => monthKey(monthForExperience(experience)) === monthKey(calendarMonth),
  );
  const selectedDayKey = selected ? dayKey(dateParts(selected.startsAt, selected.timezone)) : null;
  const selectedDayExperiences = selectedDayKey
    ? allExperiences.filter(
      (experience) => dayKey(dateParts(experience.startsAt, experience.timezone)) === selectedDayKey,
    )
    : [];

  useEffect(() => {
    function selectFromHash() {
      const id = decodeURIComponent(window.location.hash.slice(1)).replace(/^experience-/, "");
      const match = allExperiences.find((experience) => experience.id === id);
      if (!match) return;
      setSelectedId(match.id);
      setCalendarMonth(monthForExperience(match));
      window.requestAnimationFrame(() => {
        document.getElementById(`experience-${match.id}`)?.scrollIntoView({ block: "start" });
      });
    }

    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    window.addEventListener("popstate", selectFromHash);
    return () => {
      window.removeEventListener("hashchange", selectFromHash);
      window.removeEventListener("popstate", selectFromHash);
    };
  }, [allExperiences]);

  function selectExperience(experience: MemberExperienceSummary, scroll = true) {
    setSelectedId(experience.id);
    setCalendarMonth(monthForExperience(experience));
    setError(null);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#experience-${encodeURIComponent(experience.id)}`,
    );
    if (scroll) {
      window.requestAnimationFrame(() => {
        document.getElementById(`experience-${experience.id}`)?.scrollIntoView({ block: "start" });
      });
    }
  }

  function moveCalendar(amount: number) {
    const nextMonth = shiftMonth(calendarMonth, amount);
    const firstInMonth = allExperiences.find(
      (experience) => monthKey(monthForExperience(experience)) === monthKey(nextMonth),
    );
    setCalendarMonth(nextMonth);
    setSelectedId(firstInMonth?.id ?? null);
    setError(null);
    window.history.replaceState(
      null,
      "",
      firstInMonth
        ? `${window.location.pathname}${window.location.search}#experience-${encodeURIComponent(firstInMonth.id)}`
        : `${window.location.pathname}${window.location.search}`,
    );
  }

  async function changeRegistration(experience: MemberExperienceSummary, action: "cancel" | "register") {
    if (!writable || pendingId || !experience.registrationHref) return;
    setPendingId(experience.id);
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
      const update = (candidate: MemberExperienceSummary) =>
        candidate.id === experience.id
          ? { ...candidate, registrationState: payload.registration!.status! }
          : candidate;
      setExperiences((current) => ({
        ...current,
        past: current.past.map(update),
        upcoming: current.upcoming.map(update),
      }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Registration could not be saved.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="member-profile-dossier mx-auto max-w-[82rem] pb-20 pt-1 sm:pb-24 sm:pt-2" data-member-experiences>
      <header className="mt-5 flex items-end justify-between gap-5 sm:mt-7">
        <h1 className="ui-heading inline-block bg-[var(--color-highlight)] px-[0.26em] py-[0.14em] text-[clamp(1.9rem,4vw,3.6rem)] font-black uppercase leading-[0.88] tracking-[-0.05em] text-[#080605]">
          Experiences
        </h1>
        <p className="pb-1 text-right font-[var(--font-body)] text-[0.62rem] font-bold uppercase leading-snug tracking-[0.04em] text-black/48">
          {String(experiences.upcoming.length).padStart(2, "0")} upcoming
          <br />
          {String(experiences.past.length).padStart(2, "0")} past
        </p>
      </header>

      {allExperiences.length ? (
        <>
          <section aria-labelledby="calendar-month" className="mt-6 rounded-[4px] bg-black/[0.035] p-2 sm:mt-7 sm:p-3" data-experiences-calendar>
            <div className="flex items-center justify-between gap-4 px-1 pb-2 sm:px-2 sm:pb-3">
              <button
                aria-label="Previous month"
                className="grid size-11 place-items-center rounded-full bg-black/[0.055] text-lg text-black/64 transition-colors hover:bg-black hover:text-[var(--color-bone)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]"
                onClick={() => moveCalendar(-1)}
                type="button"
              >
                ←
              </button>
              <h2 className="ui-heading text-center text-[clamp(1.35rem,3vw,2.15rem)] font-black uppercase leading-none tracking-[-0.035em]" id="calendar-month">
                {monthLabel(calendarMonth)}
              </h2>
              <button
                aria-label="Next month"
                className="grid size-11 place-items-center rounded-full bg-black/[0.055] text-lg text-black/64 transition-colors hover:bg-black hover:text-[var(--color-bone)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]"
                onClick={() => moveCalendar(1)}
                type="button"
              >
                →
              </button>
            </div>

            <table className="w-full table-fixed border-separate border-spacing-1 sm:border-spacing-2">
              <caption className="sr-only">Events for {monthLabel(calendarMonth)}</caption>
              <thead>
                <tr>
                  {WEEKDAYS.map((weekday) => (
                    <th className="pb-1 text-center font-[var(--font-body)] text-[0.55rem] font-black uppercase tracking-[0.04em] text-black/38" key={weekday} scope="col">
                      {weekday}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calendarWeeks(calendarMonth).map((week, weekIndex) => (
                  <tr key={`${calendarMonth.year}-${calendarMonth.month}-${weekIndex}`}>
                    {week.map((day, weekdayIndex) => {
                      if (!day) {
                        return <td aria-hidden="true" key={`empty-${weekdayIndex}`}><span className="block h-[3.25rem] sm:h-[4.5rem]" /></td>;
                      }
                      const cellDate = { day, month: calendarMonth.month, year: calendarMonth.year };
                      const events = monthExperiences.filter(
                        (experience) => dayKey(dateParts(experience.startsAt, experience.timezone)) === dayKey(cellDate),
                      );
                      const selectedHere = events.some((experience) => experience.id === selectedId);
                      return (
                        <td className="align-top" key={day}>
                          {events.length ? (
                            <button
                              aria-controls="experience-detail"
                              aria-label={`${calendarDateLabel(cellDate)}: ${events.map((experience) => experience.title).join(", ")}`}
                              aria-pressed={selectedHere}
                              className={`group flex h-[3.25rem] w-full flex-col rounded-[3px] p-1.5 text-left transition-[background-color,box-shadow,transform] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)] sm:h-[4.5rem] sm:p-2 ${selectedHere ? "bg-[#171411] text-[var(--color-bone)] shadow-[3px_4px_0_var(--color-poster)]" : "bg-white/45 text-black/72 hover:bg-white/80"}`}
                              onClick={() => selectExperience(events[0])}
                              type="button"
                            >
                              <span className="font-[var(--font-body)] text-[0.62rem] font-black tabular-nums sm:text-xs">{String(day).padStart(2, "0")}</span>
                              <span className={`mt-1 hidden text-pretty font-[var(--font-body)] text-[0.58rem] font-bold leading-[1.05] sm:line-clamp-2 ${selectedHere ? "text-white/72" : "text-black/54"}`}>{events[0].title}</span>
                              <span aria-hidden="true" className="mt-auto flex gap-1">
                                {events.slice(0, 3).map((experience) => <span className={`h-1.5 w-3 rounded-full ${markerClass(experience)}`} key={experience.id} />)}
                              </span>
                            </button>
                          ) : (
                            <span className="block h-[3.25rem] rounded-[3px] bg-white/18 p-1.5 font-[var(--font-body)] text-[0.6rem] font-semibold tabular-nums text-black/24 sm:h-[4.5rem] sm:p-2 sm:text-xs">
                              {String(day).padStart(2, "0")}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {selected ? (
            <section
              aria-labelledby="selected-experience-title"
              aria-live="polite"
              className="scroll-mt-24 pt-8 sm:pt-10"
              data-experience-detail
              id="experience-detail"
            >
              <span aria-hidden="true" className="block scroll-mt-24" id={`experience-${selected.id}`} />
              {selectedDayExperiences.length > 1 ? (
                <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Events on this date">
                  <span className="[font-family:var(--font-cadehandy2)] text-xl leading-none text-[var(--color-poster)]">On this day</span>
                  {selectedDayExperiences.map((experience) => (
                    <button
                      aria-pressed={experience.id === selected.id}
                      className={`min-h-11 rounded-full px-4 font-[var(--font-body)] text-[0.62rem] font-black uppercase tracking-[0.035em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)] ${experience.id === selected.id ? "bg-black text-[var(--color-bone)]" : "bg-black/[0.055] text-black/60 hover:bg-black/10"}`}
                      key={experience.id}
                      onClick={() => selectExperience(experience, false)}
                      type="button"
                    >
                      {experience.title}
                    </button>
                  ))}
                </div>
              ) : null}

              <article className="grid gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(21rem,0.88fr)] lg:items-start lg:gap-9">
                <EventArtwork experience={selected} />

                <div className="min-w-0 lg:pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="[font-family:var(--font-cadehandy2)] text-[1.35rem] leading-none text-[var(--color-poster)]">
                      {pastIds.has(selected.id) ? "Previously held" : "Coming up"}
                    </p>
                    <span className="inline-flex items-center gap-2 font-[var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.035em] text-black/52">
                      <span aria-hidden="true" className={`size-1.5 rounded-full ${markerClass(selected)}`} />
                      {registrationLabel(selected.registrationState)}
                    </span>
                  </div>

                  <h2 className="ui-heading mt-3 text-balance text-[clamp(2.5rem,5vw,5rem)] font-black uppercase leading-[0.82] tracking-[-0.055em] text-[#171411]" id="selected-experience-title">
                    {selected.title}
                  </h2>

                  {selected.summary ? (
                    <p className="mt-5 max-w-2xl font-[var(--font-body)] text-sm leading-relaxed text-black/62 sm:text-base">
                      {selected.summary}
                    </p>
                  ) : null}

                  <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[4px] bg-black/[0.04] p-3">
                      <dt className="[font-family:var(--font-cadehandy2)] text-[1.05rem] leading-none text-[var(--color-poster)]">Date</dt>
                      <dd className="mt-1.5 font-[var(--font-body)] text-xs font-semibold leading-snug text-black/68"><time dateTime={selected.startsAt}>{formatDate(selected.startsAt, selected.timezone)}</time></dd>
                    </div>
                    <div className="rounded-[4px] bg-black/[0.04] p-3">
                      <dt className="[font-family:var(--font-cadehandy2)] text-[1.05rem] leading-none text-[var(--color-poster)]">Time</dt>
                      <dd className="mt-1.5 font-[var(--font-body)] text-xs font-semibold leading-snug text-black/68">{formatTimeRange(selected)}</dd>
                    </div>
                    <div className="rounded-[4px] bg-black/[0.04] p-3">
                      <dt className="[font-family:var(--font-cadehandy2)] text-[1.05rem] leading-none text-[var(--color-poster)]">Place</dt>
                      <dd className="mt-1.5 font-[var(--font-body)] text-xs font-semibold leading-snug text-black/68">{selected.locationLabel ?? "Details to come"}</dd>
                    </div>
                    <div className="rounded-[4px] bg-black/[0.04] p-3">
                      <dt className="[font-family:var(--font-cadehandy2)] text-[1.05rem] leading-none text-[var(--color-poster)]">For</dt>
                      <dd className="mt-1.5 font-[var(--font-body)] text-xs font-semibold leading-snug text-black/68">{selected.audienceLabel}</dd>
                    </div>
                  </dl>

                  {error ? <p aria-live="assertive" className="mt-4 rounded-[4px] bg-[var(--color-poster)]/10 px-4 py-3 font-[var(--font-body)] text-sm text-black/68" role="alert">{error}</p> : null}

                  <div className="mt-6 flex flex-wrap gap-3">
                    {selected.registrationState === "external" && selected.registrationHref ? (
                      <a className="inline-flex min-h-11 items-center rounded-[3px] bg-black px-5 font-[var(--font-body)] text-[0.65rem] font-black uppercase tracking-[0.045em] text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-poster)]" href={selected.registrationHref} rel="noreferrer" target="_blank">Register ↗</a>
                    ) : selected.registrationHref && selected.registrationState !== "closed" ? (
                      <button
                        aria-busy={pendingId === selected.id}
                        className="inline-flex min-h-11 items-center rounded-[3px] bg-black px-5 font-[var(--font-body)] text-[0.65rem] font-black uppercase tracking-[0.045em] text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-poster)] disabled:cursor-wait disabled:opacity-45"
                        disabled={!writable || Boolean(pendingId)}
                        onClick={() => changeRegistration(selected, ["registered", "waitlisted"].includes(selected.registrationState) ? "cancel" : "register")}
                        type="button"
                      >
                        {pendingId === selected.id ? "Saving" : ["registered", "waitlisted"].includes(selected.registrationState) ? "Release place" : "Reserve place"}
                      </button>
                    ) : null}

                    {selected.meetingUrl ? (
                      <a className="inline-flex min-h-11 items-center rounded-[3px] bg-[var(--color-verdigris)] px-5 font-[var(--font-body)] text-[0.65rem] font-black uppercase tracking-[0.045em] text-[var(--color-bone)] transition-colors hover:bg-[#466b5c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-verdigris)]" href={selected.meetingUrl} rel="noreferrer" target="_blank">Join room ↗</a>
                    ) : null}

                    {!selected.detailHref.startsWith("/my/experiences#") ? (
                      <Link className="inline-flex min-h-11 items-center rounded-[3px] bg-black/[0.055] px-5 font-[var(--font-body)] text-[0.65rem] font-black uppercase tracking-[0.045em] text-black/66 transition-colors hover:bg-[var(--color-shop)] hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-poster)]" href={selected.detailHref}>
                        {selected.detailHref.startsWith("/community") ? "Community page" : selected.detailHref.startsWith("/my/circle") ? "Open Circle" : "Open details"} →
                      </Link>
                    ) : null}
                  </div>
                </div>
              </article>
            </section>
          ) : (
            <section aria-live="polite" className="mt-8 rounded-[4px] bg-black/[0.04] px-5 py-10 text-center" id="experience-detail">
              <p className="[font-family:var(--font-cadehandy2)] text-2xl text-[var(--color-poster)]">Nothing on this page</p>
              <p className="mt-2 font-[var(--font-body)] text-sm text-black/52">Choose another month to find an experience.</p>
            </section>
          )}
        </>
      ) : (
        <section className="mt-8 rounded-[4px] bg-black/[0.04] px-5 py-12 sm:py-16">
          <p className="[font-family:var(--font-cadehandy2)] text-2xl leading-none text-[var(--color-poster)]">The calendar is clear</p>
          <h2 className="ui-heading mt-3 text-3xl font-black uppercase leading-[0.9] tracking-[-0.04em]">Nothing scheduled yet.</h2>
          <p className="mt-3 max-w-lg font-[var(--font-body)] text-sm leading-relaxed text-black/52">The next Circle room or Ruined gathering will appear here when it is ready.</p>
        </section>
      )}
    </main>
  );
}
