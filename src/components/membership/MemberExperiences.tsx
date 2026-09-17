"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { StudioEvent } from "@/data/events";
import { usePublicEvents } from "@/lib/events/use-public-events";
import type {
  MemberExperienceSummary,
  MemberExperiencesSnapshot,
} from "@/lib/membership/model";

import styles from "./MemberExperiences.module.css";

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

function publicEventFor(experience: MemberExperienceSummary, events: StudioEvent[]): StudioEvent | null {
  if (!experience.detailHref.startsWith("/community#")) return null;
  const id = decodeURIComponent(experience.detailHref.slice("/community#".length));
  return events.find((event) => event.id === id) ?? null;
}

function markerClass(experience: MemberExperienceSummary) {
  if (experience.kind.includes("circle")) return "bg-[var(--color-shop)]";
  if (experience.audienceLabel.toLowerCase().includes("block")) return "bg-[var(--color-workwear)]";
  if (experience.kind.includes("public")) return "bg-[var(--member-red)]";
  return "bg-[var(--color-verdigris)]";
}

function posterClass(experience: MemberExperienceSummary) {
  if (experience.kind.includes("circle")) return "bg-[var(--color-shop)] text-[#2a2a2a]";
  if (experience.audienceLabel.toLowerCase().includes("block")) return "bg-[var(--color-workwear)] text-[#2a2a2a]";
  if (experience.kind.includes("public")) return "bg-[var(--member-blue)] text-[#2a2a2a]";
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
  const events = usePublicEvents();
  const publicEvent = publicEventFor(experience, events);
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
      <div className="relative aspect-[4/3] overflow-hidden rounded-[4px] bg-black" data-member-artwork>
        <Image
          alt={publicEvent.gallery?.[0]?.alt ?? `${experience.title} event artwork`}
          className="object-cover saturate-[0.88] contrast-[1.03]"
          fill
          sizes="(min-width: 1024px) 52vw, 100vw"
          src={publicEvent.image}
        />
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
        <span className="absolute inset-x-4 top-4 flex items-center justify-between font-[var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.06em] text-[var(--color-bone)] sm:inset-x-5 sm:top-5">
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
  const [view, setView] = useState<"list" | "calendar">("list");
  const [detailOpen, setDetailOpen] = useState(false);

  const allExperiences = useMemo(
    () => [...experiences.upcoming, ...experiences.past]
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)),
    [experiences],
  );
  const upcoming = useMemo(
    () => [...experiences.upcoming].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)),
    [experiences.upcoming],
  );
  const past = useMemo(
    () => [...experiences.past].sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt)),
    [experiences.past],
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
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1)).replace(/^experience-/, "");
      } catch {
        return;
      }
      const match = allExperiences.find((experience) => experience.id === id);
      if (!match) return;
      setSelectedId(match.id);
      setDetailOpen(true);
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
    setDetailOpen(true);
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
    setDetailOpen(false);
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

  function eventRow(experience: MemberExperienceSummary) {
    const date = dateParts(experience.startsAt, experience.timezone);
    const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(date.year, date.month, 1)));
    const isSelected = detailOpen && selectedId === experience.id;
    return (
      <li className={styles.eventRow} data-selected={isSelected || undefined} key={experience.id}>
        <time className={styles.date} dateTime={experience.startsAt} aria-label={formatDate(experience.startsAt, experience.timezone)}>
          <span>{String(date.day).padStart(2, "0")}</span>
          <span>{month}</span>
        </time>
        <div className={styles.rowContent}>
          <h3>{experience.title}</h3>
          <p>{experience.audienceLabel} <span aria-hidden="true">·</span> {formatTime(experience.startsAt, experience.timezone)}</p>
          {["registered", "waitlisted"].includes(experience.registrationState) ? (
            <span className={styles.reservation}>{registrationLabel(experience.registrationState)}</span>
          ) : null}
        </div>
        <button
          aria-controls="experience-detail"
          aria-label={`Details for ${experience.title}`}
          aria-expanded={isSelected}
          className={styles.detailsButton}
          onClick={() => selectExperience(experience)}
          type="button"
        >
          Details
        </button>
      </li>
    );
  }

  return (
    <main className={`member-journey-page member-events-page ${styles.page}`} data-member-experiences>
      <header className={styles.header}>
        <p className={`member-handwritten ${styles.kicker}`}>Come together</p>
        <h1 className="member-page-title">Be there.</h1>
        <p className={styles.intro}>A few reasons to get out of your head.</p>
      </header>

      <section aria-label="Browse events" className={styles.browse}>
        <div className={styles.sectionHeader}>
          <h2 className={`member-handwritten ${styles.sectionTitle}`}>{view === "list" ? "Upcoming" : "Your calendar"}</h2>
          <div aria-label="Event view" className={styles.viewSwitch}>
            <button aria-pressed={view === "list"} onClick={() => setView("list")} type="button">List</button>
            <button aria-pressed={view === "calendar"} onClick={() => setView("calendar")} type="button">Calendar</button>
          </div>
        </div>
        {view === "list" ? (
          upcoming.length ? (
            <ol className={styles.eventList}>{upcoming.map(eventRow)}</ol>
          ) : (
            <div className={styles.empty}>
              <h3>Nothing scheduled yet.</h3>
              <p>The next Circle room or Ruined gathering will appear here when it is ready.</p>
            </div>
          )
        ) : (
          <section aria-labelledby="calendar-month" className={styles.calendar} data-experiences-calendar>
            <div className="flex items-center justify-between gap-4 px-1 pb-2 sm:px-2 sm:pb-3">
              <button
                aria-label="Previous month"
                className="grid size-11 place-items-center rounded-full bg-[var(--member-soft)] text-lg text-[var(--member-muted)] transition-colors hover:bg-black hover:text-[var(--color-bone)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]"
                onClick={() => moveCalendar(-1)}
                type="button"
              >
                ←
              </button>
              <h2 className={styles.calendarTitle} id="calendar-month">
                {monthLabel(calendarMonth)}
              </h2>
              <button
                aria-label="Next month"
                className="grid size-11 place-items-center rounded-full bg-[var(--member-soft)] text-lg text-[var(--member-muted)] transition-colors hover:bg-black hover:text-[var(--color-bone)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]"
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
                    <th className="pb-1 text-center font-[var(--font-body)] text-[0.55rem] font-black uppercase tracking-[0.04em] text-[var(--member-muted)]" key={weekday} scope="col">
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
                              className={`group flex h-[3.25rem] w-full flex-col rounded-[3px] p-1.5 text-left transition-[background-color,box-shadow,transform] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)] sm:h-[4.5rem] sm:p-2 ${selectedHere ? "bg-[var(--member-subtle)] text-[var(--member-ink)] shadow-[inset_0_-3px_0_#d0312d]" : "bg-[var(--member-soft)] text-[var(--member-muted)] hover:bg-[var(--member-soft)]"}`}
                              onClick={() => selectExperience(events[0])}
                              type="button"
                            >
                              <span className="font-[var(--font-body)] text-[0.62rem] font-black tabular-nums sm:text-xs">{String(day).padStart(2, "0")}</span>
                              <span className={`mt-1 hidden text-pretty font-[var(--font-body)] text-[0.58rem] font-bold leading-[1.05] sm:line-clamp-2 ${selectedHere ? "text-[var(--member-muted)]" : "text-[var(--member-muted)]"}`}>{events[0].title}</span>
                              <span aria-hidden="true" className="mt-auto flex gap-1">
                                {events.slice(0, 3).map((experience) => <span className={`h-1.5 w-3 rounded-full ${markerClass(experience)}`} key={experience.id} />)}
                              </span>
                            </button>
                          ) : (
                            <span className="block h-[3.25rem] rounded-[3px] bg-[var(--member-soft)] p-1.5 font-[var(--font-body)] text-[0.6rem] font-semibold tabular-nums text-[var(--member-muted)] sm:h-[4.5rem] sm:p-2 sm:text-xs">
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
        )}
      </section>

      {past.length ? (
        <details className={styles.past}>
          <summary>Previously <span>{String(past.length).padStart(2, "0")}</span><span className={styles.pastToggle} aria-hidden="true">+</span></summary>
          <ol className={styles.eventList}>{past.map(eventRow)}</ol>
        </details>
      ) : null}

          {selected && detailOpen ? (
            <section
              aria-labelledby="selected-experience-title"
              aria-live="polite"
              className={styles.detail}
              data-experience-detail
              id="experience-detail"
            >
              <span aria-hidden="true" className="block scroll-mt-24" id={`experience-${selected.id}`} />
              <div className={styles.detailHeading}>
                <p className="member-handwritten">The details</p>
                <button className={styles.detailsButton} onClick={() => {
                  setDetailOpen(false);
                  setError(null);
                  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
                }} type="button">Close <span aria-hidden="true">×</span></button>
              </div>
              {selectedDayExperiences.length > 1 ? (
                <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Events on this date">
                  <span className="[font-family:var(--font-cadehandy2)] text-xl leading-none text-[var(--member-red)]">On this day</span>
                  {selectedDayExperiences.map((experience) => (
                    <button
                      aria-pressed={experience.id === selected.id}
                      className={`min-h-11 rounded-full px-4 font-[var(--font-body)] text-[0.62rem] font-black uppercase tracking-[0.035em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)] ${experience.id === selected.id ? "bg-black text-[var(--color-bone)]" : "bg-[var(--member-soft)] text-[var(--member-muted)] hover:bg-[var(--member-soft)]"}`}
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
                    <p className="[font-family:var(--font-cadehandy2)] text-[1.35rem] leading-none text-[var(--member-red)]">
                      {pastIds.has(selected.id) ? "Previously held" : "Coming up"}
                    </p>
                    <span className="inline-flex items-center gap-2 font-[var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.035em] text-[var(--member-muted)]">
                      <span aria-hidden="true" className={`size-1.5 rounded-full ${markerClass(selected)}`} />
                      {registrationLabel(selected.registrationState)}
                    </span>
                  </div>

                  <h2 className={styles.detailTitle} id="selected-experience-title">
                    {selected.title}
                  </h2>

                  {selected.summary ? (
                    <p className="mt-5 max-w-2xl font-[var(--font-body)] text-sm leading-relaxed text-[var(--member-muted)] sm:text-base">
                      {selected.summary}
                    </p>
                  ) : null}

                  <dl className={styles.facts}>
                    <div className={styles.fact}>
                      <dt className="[font-family:var(--font-cadehandy2)] text-[1.05rem] leading-none text-[var(--member-red)]">Date</dt>
                      <dd className="mt-1.5 font-[var(--font-body)] text-xs font-semibold leading-snug text-[var(--member-muted)]"><time dateTime={selected.startsAt}>{formatDate(selected.startsAt, selected.timezone)}</time></dd>
                    </div>
                    <div className={styles.fact}>
                      <dt className="[font-family:var(--font-cadehandy2)] text-[1.05rem] leading-none text-[var(--member-red)]">Time</dt>
                      <dd className="mt-1.5 font-[var(--font-body)] text-xs font-semibold leading-snug text-[var(--member-muted)]">{formatTimeRange(selected)}</dd>
                    </div>
                    <div className={styles.fact}>
                      <dt className="[font-family:var(--font-cadehandy2)] text-[1.05rem] leading-none text-[var(--member-red)]">Place</dt>
                      <dd className="mt-1.5 font-[var(--font-body)] text-xs font-semibold leading-snug text-[var(--member-muted)]">{selected.locationLabel ?? "Details to come"}</dd>
                    </div>
                    <div className={styles.fact}>
                      <dt className="[font-family:var(--font-cadehandy2)] text-[1.05rem] leading-none text-[var(--member-red)]">For</dt>
                      <dd className="mt-1.5 font-[var(--font-body)] text-xs font-semibold leading-snug text-[var(--member-muted)]">{selected.audienceLabel}</dd>
                    </div>
                  </dl>

                  {error ? <p aria-live="assertive" className="mt-4 rounded-[4px] bg-[var(--color-poster)]/10 px-4 py-3 font-[var(--font-body)] text-sm text-[var(--member-muted)]" role="alert">{error}</p> : null}

                  <div className="mt-6 flex flex-wrap gap-3">
                    {selected.registrationState === "external" && selected.registrationHref ? (
                      <a className={styles.primaryAction} href={selected.registrationHref} rel="noreferrer" target="_blank">Register ↗</a>
                    ) : selected.registrationHref && selected.registrationState !== "closed" ? (
                      <button
                        aria-busy={pendingId === selected.id}
                        className={["registered", "waitlisted"].includes(selected.registrationState) ? styles.detailsButton : styles.primaryAction}
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
                      <Link className="inline-flex min-h-11 items-center rounded-[3px] bg-[var(--member-soft)] px-5 font-[var(--font-body)] text-[0.65rem] font-black uppercase tracking-[0.045em] text-[var(--member-muted)] transition-colors hover:bg-[var(--color-shop)] hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-poster)]" href={selected.detailHref}>
                        {selected.detailHref.startsWith("/community") ? "Community page" : selected.detailHref.startsWith("/my/circle") ? "Open Circle" : "Open details"} →
                      </Link>
                    ) : null}
                  </div>
                </div>
              </article>
            </section>
          ) : <div id="experience-detail" hidden />}
    </main>
  );
}
