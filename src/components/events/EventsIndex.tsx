import Image from "next/image";
import Link from "next/link";
import { EVENTS, type StudioEvent } from "@/data/events";

export default function EventsIndex() {
  const [featured, ...programme] = EVENTS;

  return (
    <main className="min-h-screen bg-[var(--color-bone)] text-[var(--color-faded)]">
      <header className="border-b border-black/15 px-5 pb-12 pt-14 sm:px-10 sm:pb-16 sm:pt-20">
        <div className="mx-auto max-w-[90rem]">
          <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-[0.56rem] uppercase tracking-[0.28em] text-black/45">
            <Link href="/#events" className="transition-colors hover:text-[var(--color-poster)]">
              ← Return to the walk
            </Link>
            <span>Programme · Autumn / MMXXVI</span>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-12 md:items-end">
            <h1 className="display text-[clamp(4rem,12vw,10rem)] leading-[0.78] md:col-span-8">
              What&apos;s <span className="italic text-[var(--color-poster)]">on.</span>
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-black/60 md:col-span-4 md:pb-1 sm:text-base">
              Open studios, conversations, installations, and late sessions from
              the rooms inside Studio No. 17.
            </p>
          </div>
        </div>
      </header>

      <section id={featured.id} aria-labelledby="featured-event" className="scroll-mt-28 px-5 py-5 sm:px-10 sm:py-10">
        <div className="mx-auto max-w-[90rem]">
          <Link
            href={`/contact?event=${featured.id}`}
            className="group grid overflow-hidden bg-[#11100e] text-[var(--color-bone)] md:grid-cols-12"
          >
            <div className="relative min-h-[22rem] md:col-span-8 md:min-h-[42rem]">
              <Image
                src={featured.image}
                alt=""
                fill
                priority
                sizes="(min-width: 768px) 67vw, 100vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.015]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
              <span className="absolute left-4 top-4 border border-white/35 bg-black/35 px-3 py-2 font-mono text-[0.52rem] uppercase tracking-[0.26em] backdrop-blur-sm sm:left-6 sm:top-6">
                Next · {featured.admission}
              </span>
            </div>
            <div className="flex min-h-[26rem] flex-col justify-between border-t border-white/15 p-6 md:col-span-4 md:border-l md:border-t-0 md:p-8 lg:p-10">
              <EventDate event={featured} />
              <div>
                <p className="font-mono text-[0.55rem] uppercase tracking-[0.3em] text-[var(--color-poster)]">
                  {featured.eyebrow}
                </p>
                <h2 id="featured-event" className="display mt-4 text-[clamp(2.5rem,5vw,4.8rem)] leading-[0.88]">
                  {featured.title}
                </h2>
                <p className="mt-5 max-w-md text-sm leading-relaxed text-white/60 sm:text-base">
                  {featured.summary}
                </p>
              </div>
              <span className="ui-heading mt-8 flex items-center justify-between border-t border-white/20 pt-4 text-[0.6rem] uppercase tracking-[0.22em]">
                Request a place <span aria-hidden>↗</span>
              </span>
            </div>
          </Link>
        </div>
      </section>

      <section aria-labelledby="programme-heading" className="px-5 pb-24 pt-10 sm:px-10 sm:pb-32 sm:pt-16">
        <div className="mx-auto max-w-[90rem]">
          <div className="flex items-end justify-between gap-6 border-b border-black/20 pb-5">
            <div>
              <p className="font-mono text-[0.54rem] uppercase tracking-[0.32em] text-[var(--color-poster)]">
                Programme index
              </p>
              <h2 id="programme-heading" className="display mt-2 text-3xl sm:text-5xl">
                Upcoming / ongoing
              </h2>
            </div>
            <span className="hidden font-mono text-[0.54rem] uppercase tracking-[0.24em] text-black/40 sm:block">
              {String(EVENTS.length).padStart(2, "0")} entries
            </span>
          </div>

          <div>
            {programme.map((event, index) => (
              <EventRow key={event.id} event={event} index={index + 2} />
            ))}
          </div>

          <div className="mt-16 grid gap-6 border-t border-black/20 pt-7 sm:grid-cols-2 sm:items-end">
            <div>
              <p className="font-mono text-[0.54rem] uppercase tracking-[0.28em] text-black/40">
                Studio bulletin
              </p>
              <p className="display mt-3 max-w-xl text-2xl sm:text-4xl">
                Dates move. The work remains.
              </p>
            </div>
            <div className="sm:text-right">
              <a
                href="mailto:studio@ruined.studio?subject=Ruined%20events%20bulletin"
                className="ui-heading inline-flex border border-black px-5 py-3 text-[0.6rem] uppercase tracking-[0.24em] transition-colors hover:bg-black hover:text-[var(--color-bone)]"
              >
                Join the event bulletin →
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function EventDate({ event }: { event: StudioEvent }) {
  return (
    <div className="font-mono text-[0.58rem] uppercase tracking-[0.24em] text-white/55">
      <p className="text-white">{event.date}</p>
      <p className="mt-2">{event.time}</p>
      <p className="mt-1">{event.location}</p>
    </div>
  );
}

function EventRow({ event, index }: { event: StudioEvent; index: number }) {
  return (
    <Link
      id={event.id}
      href={`/contact?event=${event.id}`}
      className="group grid scroll-mt-28 gap-5 border-b border-black/15 py-6 transition-colors hover:text-[var(--color-poster)] sm:grid-cols-12 sm:items-stretch sm:py-8"
    >
      <div className="relative aspect-[16/10] overflow-hidden sm:col-span-3 sm:aspect-[4/3]">
        <Image src={event.image} alt="" fill sizes="(min-width: 640px) 25vw, 100vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.02]" />
        <span className="absolute left-2 top-2 border border-white/25 bg-black/30 px-2 py-1 font-mono text-[0.44rem] uppercase tracking-[0.16em] text-white backdrop-blur-sm">{event.status}</span>
      </div>
      <div className="flex items-baseline justify-between font-mono text-[0.54rem] uppercase tracking-[0.22em] text-black/45 sm:col-span-2 sm:block">
        <span>{String(index).padStart(2, "0")}</span>
        <time dateTime={event.dateTime} className="sm:mt-4 sm:block">
          {event.date}
        </time>
      </div>
      <div className="sm:col-span-4">
        <p className="font-mono text-[0.5rem] uppercase tracking-[0.28em] text-[var(--color-verdigris)]">
          {event.eyebrow} · {event.status}
        </p>
        <h3 className="display mt-2 text-2xl leading-none sm:text-4xl">{event.title}</h3>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-black/55">{event.summary}</p>
      </div>
      <div className="flex items-end justify-between gap-4 font-mono text-[0.54rem] uppercase tracking-[0.2em] text-black/45 sm:col-span-3 sm:h-full sm:flex-col sm:items-end">
        <span className="text-right">{event.location}</span>
        <span className="text-[var(--color-faded)] transition-transform group-hover:translate-x-1">
          {event.admission} ↗
        </span>
      </div>
    </Link>
  );
}
