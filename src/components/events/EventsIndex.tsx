"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import EventGallery from "@/components/events/EventGallery";
import { EVENTS, type StudioEvent } from "@/data/events";

const NEXT_AVAILABLE = EVENTS.find((event) => event.status === "Upcoming");
const DEFAULT_EVENT = NEXT_AVAILABLE ?? EVENTS[0];
const ARCHIVE_EVENTS = EVENTS.filter((event) => event.status === "Ended");
const UPCOMING_EVENTS = EVENTS.filter((event) => event.status !== "Ended");

function eventState(event: StudioEvent) {
  if (event.status === "Ended") return "Archive";
  if (event.id === NEXT_AVAILABLE?.id) return "Next available";
  return event.status === "Ongoing" ? "Ongoing" : "Scheduled";
}

export default function EventsIndex() {
  const [selectedId, setSelectedId] = useState(DEFAULT_EVENT?.id ?? "");
  const selected =
    EVENTS.find((event) => event.id === selectedId) ?? DEFAULT_EVENT;

  useEffect(() => {
    const selectFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const event = EVENTS.find((candidate) => candidate.id === id);
      if (event) setSelectedId(event.id);
    };

    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
  }, []);

  function selectEvent(event: StudioEvent) {
    setSelectedId(event.id);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${event.id}`
    );
  }

  if (!selected) return null;

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
        aria-labelledby="event-index-heading"
        className="bg-[var(--color-bone)] px-4 pb-4 pt-0 text-[var(--color-faded)] sm:px-8 sm:pb-8"
      >
        <div className="mx-auto max-w-[96rem]">
          <header className="grid gap-3 border-y border-black/25 py-3 sm:grid-cols-[1fr_minmax(18rem,28rem)] sm:items-center sm:gap-6 sm:py-4">
            <div className="flex items-center justify-between gap-5 sm:justify-start">
              <h2
                id="event-index-heading"
                className="ui-heading text-[0.58rem] uppercase tracking-[0.14em] text-[var(--color-poster)]"
              >
                Community events
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
              className="border-b border-black/25 py-4 sm:py-6"
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
