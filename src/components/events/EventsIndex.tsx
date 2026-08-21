"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import EventGallery from "@/components/events/EventGallery";
import { EVENTS, type StudioEvent } from "@/data/events";

const NEXT_AVAILABLE = EVENTS.find((event) => event.status === "Upcoming");
const ARCHIVE_EVENTS = EVENTS.filter((event) => event.status === "Ended");
const UPCOMING_EVENTS = EVENTS.filter((event) => event.status !== "Ended");

function eventState(event: StudioEvent) {
  if (event.status === "Ended") return "Archive";
  if (event.id === NEXT_AVAILABLE?.id) return "Next available";
  return event.status === "Ongoing" ? "Ongoing" : "Scheduled";
}

export default function EventsIndex() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId
    ? EVENTS.find((event) => event.id === selectedId)
    : undefined;

  useEffect(() => {
    const selectFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const event = EVENTS.find((candidate) => candidate.id === id);
      setSelectedId(event?.id ?? null);
    };

    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    window.addEventListener("popstate", selectFromHash);
    return () => {
      window.removeEventListener("hashchange", selectFromHash);
      window.removeEventListener("popstate", selectFromHash);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(selectedId)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);

  function selectEvent(event: StudioEvent) {
    setSelectedId(event.id);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${event.id}`
    );
  }

  if (!selected) {
    return <EventsOverview onSelect={(event) => setSelectedId(event.id)} />;
  }

  const selectedState = eventState(selected);
  const statusClasses =
    selected.status === "Ended"
      ? "bg-[var(--color-poster)] text-white"
      : selected.id === NEXT_AVAILABLE?.id
        ? "bg-[var(--color-signal)] text-black"
        : "border border-black/30 text-black/55";

  return (
    <main className="-mt-[3.25rem] min-h-screen bg-black text-[var(--color-bone)] sm:-mt-[3.5rem]">
      <h1 className="sr-only">Community</h1>

      <section
        id={selected.id}
        aria-labelledby="event-index-heading"
        className="scroll-mt-14 bg-[var(--color-bone)] px-4 pb-4 pt-0 text-[var(--color-faded)] sm:px-8 sm:pb-8"
      >
        <div className="mx-auto max-w-[96rem]">
          <header className="grid gap-3 border-y border-black/25 py-3 sm:grid-cols-[1fr_minmax(18rem,28rem)] sm:items-center sm:gap-6 sm:py-4">
            <div className="flex items-center justify-between gap-5 sm:justify-start">
              <h2 id="event-index-heading">
                <Link
                  href="/community"
                  onClick={(clickEvent) => {
                    if (
                      clickEvent.button === 0 &&
                      !clickEvent.metaKey &&
                      !clickEvent.ctrlKey &&
                      !clickEvent.shiftKey &&
                      !clickEvent.altKey
                    ) {
                      setSelectedId(null);
                    }
                  }}
                  className="ui-heading text-[0.58rem] uppercase tracking-[0.14em] text-[var(--color-poster)] transition-colors hover:text-black focus-visible:text-black"
                >
                  ← All events
                </Link>
              </h2>
              <p className="ui-heading text-right text-[0.55rem] uppercase tracking-[0.14em] text-black/45">
                {String(EVENTS.length).padStart(2, "0")} dates
              </p>
            </div>

            <label className="relative block">
              <span className="sr-only">Choose an event</span>
              <select
                value={selected.id}
                onChange={(changeEvent) => {
                  const nextEvent = EVENTS.find(
                    (event) => event.id === changeEvent.target.value
                  );
                  if (nextEvent) selectEvent(nextEvent);
                }}
                className="ui-heading w-full appearance-none border border-black/30 bg-transparent px-3 py-3 pr-10 text-[0.62rem] uppercase tracking-[0.1em] text-[var(--color-faded)] outline-none transition-colors hover:bg-white focus-visible:border-[var(--color-poster)] focus-visible:ring-1 focus-visible:ring-[var(--color-poster)]"
              >
                {ARCHIVE_EVENTS.length ? (
                  <optgroup label="Archive">
                    {ARCHIVE_EVENTS.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title} — {event.date}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {UPCOMING_EVENTS.length ? (
                  <optgroup label="Upcoming">
                    {UPCOMING_EVENTS.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title} — {event.date}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-sans text-sm text-black/55"
              >
                ↓
              </span>
            </label>
          </header>

          <article className="mt-2 border-b border-black/25 sm:mt-3">
            <header
              className="grid gap-5 border-b border-black/25 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:py-6"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="min-w-0">
                <span
                  className={`ui-heading inline-block px-2 py-1 text-[0.55rem] uppercase tracking-[0.14em] ${statusClasses}`}
                >
                  {selectedState}
                </span>
                <h2 className="display mt-3 text-[clamp(3.3rem,6vw,6.25rem)] leading-[.8]">
                  {selected.title}
                </h2>
              </div>
              {selected.registration?.status === "Open" ? (
                <Link
                  href={selected.registration.href}
                  className="ui-heading inline-flex min-h-12 items-center justify-between gap-8 border border-black bg-black px-5 py-3 text-[0.62rem] uppercase tracking-[0.14em] text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:min-w-56"
                >
                  {selected.registration.label}
                  <span aria-hidden="true">→</span>
                </Link>
              ) : null}
            </header>

            <div className="py-3 sm:py-5 lg:py-6">
              {selected.video ? (
                <video
                  key={selected.id}
                  controls
                  playsInline
                  preload="metadata"
                  poster={selected.videoPoster}
                  aria-label={`${selected.title} recap video`}
                  className="mx-auto block aspect-[9/16] max-h-[80svh] w-auto max-w-full object-contain"
                >
                  <source src={selected.video} type="video/mp4" />
                  Your browser does not support embedded video.
                </video>
              ) : selected.image ? (
                <div className="relative mx-auto aspect-[4/5] w-full max-w-[56rem] overflow-hidden sm:aspect-[16/10]">
                  <Image
                    src={selected.image}
                    alt={`${selected.title} event artwork`}
                    fill
                    priority
                    sizes="(min-width: 1024px) 56rem, 100vw"
                    className="object-cover"
                  />
                </div>
              ) : null}
            </div>

            <details
              key={selected.id}
              className="group border-t border-black/25"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-4 outline-none [&::-webkit-details-marker]:hidden focus-visible:text-[var(--color-poster)] sm:py-5">
                <span className="ui-heading text-[0.62rem] uppercase tracking-[0.13em]">
                  Event details
                </span>
                <span className="flex items-center gap-3">
                  <span className="ui-heading text-[0.55rem] uppercase tracking-[0.12em] text-black/45 group-open:hidden">
                    Open
                  </span>
                  <span className="ui-heading hidden text-[0.55rem] uppercase tracking-[0.12em] text-black/45 group-open:inline">
                    Close
                  </span>
                  <span
                    aria-hidden="true"
                    className="font-sans text-xl leading-none transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </span>
              </summary>

              <div className="grid gap-6 pb-6 pt-1 sm:pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,.58fr)] lg:gap-12">
                <dl className="grid grid-cols-2 gap-4 border-t border-black/20 pt-4 sm:grid-cols-3 sm:gap-6">
                  <div>
                    <dt className="ui-heading text-[0.58rem] text-black/45">
                      Date
                    </dt>
                    <dd className="mt-1 text-sm leading-tight sm:text-base">
                      <time dateTime={selected.dateTime}>{selected.date}</time>
                    </dd>
                  </div>
                  <div>
                    <dt className="ui-heading text-[0.58rem] text-black/45">
                      Time
                    </dt>
                    <dd className="mt-1 text-sm leading-tight sm:text-base">
                      {selected.time}
                    </dd>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <dt className="ui-heading text-[0.58rem] text-black/45">
                      Place
                    </dt>
                    <dd className="mt-1 text-sm leading-tight sm:text-base">
                      {selected.location}
                    </dd>
                  </div>
                </dl>

                <div className="border-t border-black/20 pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                  {selected.summary && (
                    <p className="text-xs leading-snug text-black/65 sm:text-sm">
                      {selected.summary}
                    </p>
                  )}

                  {selected.gallery?.length ? (
                    <p className="ui-heading mt-4 text-[0.58rem] uppercase tracking-[0.12em] text-black/45">
                      Archive below · {selected.gallery.length} photographs
                    </p>
                  ) : null}
                </div>
              </div>
            </details>
          </article>
        </div>
      </section>

      {selected.gallery?.length ? (
        <EventGallery
          key={selected.id}
          eventId={selected.id}
          eventTitle={selected.title}
          images={selected.gallery}
        />
      ) : null}
    </main>
  );
}

function EventsOverview({
  onSelect,
}: {
  onSelect: (event: StudioEvent) => void;
}) {
  return (
    <main className="-mt-[3.25rem] min-h-screen bg-black text-[var(--color-bone)] sm:-mt-[3.5rem]">
      <h1 className="sr-only">Community</h1>

      <section
        aria-labelledby="all-events-heading"
        className="bg-[var(--color-bone)] px-3 pb-8 pt-0 text-[var(--color-faded)] sm:px-6 sm:pb-12"
      >
        <div className="mx-auto max-w-[96rem]">
          <header className="flex items-end justify-between gap-5 border-y border-black/25 px-1 py-4 sm:px-2 sm:py-5">
            <div>
              <p className="ui-heading text-[0.55rem] uppercase tracking-[0.14em] text-[var(--color-poster)]">
                Community
              </p>
              <h2
                id="all-events-heading"
                className="display mt-2 text-[clamp(2.8rem,7vw,6rem)] leading-[0.82]"
              >
                All events
              </h2>
            </div>
            <p className="ui-heading pb-1 text-right text-[0.52rem] uppercase tracking-[0.12em] text-black/45 sm:text-[0.58rem]">
              {String(UPCOMING_EVENTS.length).padStart(2, "0")} upcoming
              <br />
              {String(ARCHIVE_EVENTS.length).padStart(2, "0")} previously held
            </p>
          </header>

          <EventGroup
            heading="Upcoming"
            events={UPCOMING_EVENTS}
            onSelect={onSelect}
          />
          <EventGroup
            heading="Previously held"
            events={ARCHIVE_EVENTS}
            onSelect={onSelect}
          />
        </div>
      </section>
    </main>
  );
}

function EventGroup({
  heading,
  events,
  onSelect,
}: {
  heading: string;
  events: StudioEvent[];
  onSelect: (event: StudioEvent) => void;
}) {
  if (!events.length) return null;

  return (
    <section aria-labelledby={`${heading.toLowerCase().replace(" ", "-")}-heading`}>
      <header className="flex items-center justify-between border-b border-black/15 px-1 pb-3 pt-8 sm:px-2 sm:pb-4 sm:pt-10">
        <h3
          id={`${heading.toLowerCase().replace(" ", "-")}-heading`}
          className="ui-heading text-[0.62rem] uppercase tracking-[0.14em]"
        >
          {heading}
        </h3>
        <span className="ui-heading text-[0.52rem] uppercase tracking-[0.14em] text-black/40">
          {String(events.length).padStart(2, "0")}
        </span>
      </header>

      <div className="grid grid-cols-2 border-l border-t border-black/15 lg:grid-cols-4">
        {events.map((event, index) => (
          <EventCard
            key={event.id}
            event={event}
            featured={index === 0}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function EventCard({
  event,
  featured,
  onSelect,
}: {
  event: StudioEvent;
  featured: boolean;
  onSelect: (event: StudioEvent) => void;
}) {
  return (
    <Link
      href={`/community#${event.id}`}
      onClick={(clickEvent) => {
        if (
          clickEvent.button === 0 &&
          !clickEvent.metaKey &&
          !clickEvent.ctrlKey &&
          !clickEvent.shiftKey &&
          !clickEvent.altKey
        ) {
          onSelect(event);
        }
      }}
      className={`group border-b border-r border-black/15 bg-[var(--color-bone)] p-2 sm:p-3 ${
        featured ? "col-span-2" : ""
      }`}
    >
      <div
        className={`relative overflow-hidden bg-black ${
          featured
            ? "aspect-[5/4] sm:aspect-[4/3] lg:aspect-[5/4]"
            : "aspect-[4/5]"
        }`}
      >
        {event.image ? (
          <Image
            src={event.image}
            alt={event.gallery?.[0]?.alt ?? `${event.title} event artwork`}
            fill
            priority={featured}
            sizes={
              featured
                ? "(min-width: 1024px) 50vw, 100vw"
                : "(min-width: 1024px) 25vw, 50vw"
            }
            className={`object-cover transition-transform duration-700 ease-out group-hover:scale-[1.018] ${
              event.gallery?.[0]?.src === event.image ? "object-[50%_62%]" : ""
            }`}
          />
        ) : null}
        <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
        <span className="absolute inset-x-2 top-2 flex items-center justify-between font-sans text-[0.44rem] uppercase tracking-[0.16em] text-white/70 sm:inset-x-3 sm:top-3">
          <span>{String(EVENTS.indexOf(event) + 1).padStart(2, "0")}</span>
          <span>{eventState(event)}</span>
        </span>
        <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center border border-white/40 bg-black/30 text-white transition-colors group-hover:bg-[var(--color-poster)] sm:bottom-3 sm:right-3">
          ↗
        </span>
      </div>

      <div className="px-1 pb-3 pt-3 sm:pt-4">
        <h4
          className={`ui-heading leading-tight ${
            featured ? "text-xl sm:text-3xl" : "text-sm sm:text-lg"
          }`}
        >
          {event.title}
        </h4>
        <div className="mt-2 flex items-center justify-between gap-2 font-sans text-[0.44rem] uppercase tracking-[0.12em] text-black/45 sm:text-[0.5rem]">
          <time dateTime={event.dateTime}>{event.date}</time>
          <span className="shrink-0 text-[var(--color-poster)]">View event</span>
        </div>
      </div>
    </Link>
  );
}
