"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { EVENTS } from "@/data/events";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function EventsIndex() {
  const [selectedId, setSelectedId] = useState(EVENTS[0]?.id ?? "");
  const [monthCursor, setMonthCursor] = useState(() => new Date(2026, 7, 1));
  const selected = EVENTS.find((event) => event.id === selectedId) ?? EVENTS[0];
  const calendarDays = useMemo(() => {
    const year = monthCursor.getFullYear(); const month = monthCursor.getMonth();
    const leading = new Date(year, month, 1).getDay(); const count = new Date(year, month + 1, 0).getDate();
    return [...Array(leading).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [monthCursor]);
  const eventForDay = (day: number) => EVENTS.find((event) => { const date = new Date(event.dateTime); return date.getFullYear() === monthCursor.getFullYear() && date.getMonth() === monthCursor.getMonth() && date.getDate() === day; });
  function shiftMonth(offset: number) { setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1)); }

  return <main className="min-h-screen bg-black text-[var(--color-bone)]">
    <h1 className="sr-only">Community</h1>
    <section className="bg-[var(--color-bone)] px-4 pb-4 pt-0 text-[var(--color-faded)] sm:px-8 sm:pb-8"><div className="mx-auto grid max-w-[96rem] gap-px bg-black/20 lg:grid-cols-[1.1fr_.9fr]">
      <article className="relative flex min-h-[32rem] flex-col justify-end overflow-hidden bg-[#11100e] p-6 text-white sm:p-10">
        {selected?.image && <Image src={selected.image} alt={`${selected.title} event artwork`} fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover" />}
        <span className="absolute inset-0 bg-gradient-to-b from-transparent via-black/5 to-black/95" />
        <div className="relative">
          <div className="flex items-end justify-between gap-5 pb-4">
            <div className="min-w-0"><span className="ui-heading block text-[0.62rem] text-white/60">Selected event</span><h2 className="display mt-1 text-[clamp(2.8rem,6.5vw,5.5rem)] leading-[.82]">{selected?.title}</h2></div>
            <span className="ui-heading shrink-0 pb-1 text-right text-[0.62rem] text-white/65">{selected?.eyebrow}</span>
          </div>
          <dl className="grid grid-cols-3 gap-3 border-t border-white/35 pt-4 sm:gap-5"><div><dt className="ui-heading text-[0.58rem] text-white/60">Date</dt><dd className="mt-1 text-sm leading-tight sm:text-base">{selected?.date}</dd></div><div><dt className="ui-heading text-[0.58rem] text-white/60">Time</dt><dd className="mt-1 text-sm leading-tight sm:text-base">{selected?.time}</dd></div><div><dt className="ui-heading text-[0.58rem] text-white/60">Place</dt><dd className="mt-1 text-sm leading-tight sm:text-base">{selected?.location}</dd></div></dl>
        </div>
      </article>
      <div className="bg-[var(--color-bone)] p-5 sm:p-8">
        <div className="flex items-center justify-between border-b border-black/20 pb-5"><button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="text-2xl">←</button><h2 className="ui-heading text-lg">{MONTHS[monthCursor.getMonth()]} {monthCursor.getFullYear()}</h2><button onClick={() => shiftMonth(1)} aria-label="Next month" className="text-2xl">→</button></div>
        <div className="mt-5 grid grid-cols-7 text-center text-xs text-black/40">{WEEKDAYS.map((day, i) => <span key={`${day}-${i}`}>{day}</span>)}</div>
        <div className="mt-2 grid grid-cols-7 gap-1">{calendarDays.map((day, index) => { if (!day) return <span key={`empty-${index}`} />; const event = eventForDay(day); const active = event?.id === selected?.id; return <button key={day} disabled={!event} onClick={() => event && setSelectedId(event.id)} className={`aspect-square border text-sm ${event ? "border-[var(--color-poster)] font-bold" : "border-black/10 text-black/35"} ${active ? "bg-[var(--color-poster)] text-white" : ""}`} aria-label={event ? `Select ${event.title}, ${event.date}` : undefined}>{day}</button>; })}</div>
        <p className="mt-6 text-sm text-black/50">Highlighted dates are scheduled gatherings. Select one to view its details.</p>
      </div>
    </div></section>
  </main>;
}
