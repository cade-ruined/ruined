import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import BYOBRegistrationForm from "@/components/events/BYOBRegistrationForm";
import { EVENTS } from "@/data/events";
import { BYOB_02_EVENT_KEY } from "@/lib/events/byob-registration-model";

const description =
  "Register for BYOB Nº 02 from The Ruined Project.";

export const metadata: Metadata = {
  title: "Register for BYOB Nº 02",
  description,
  alternates: { canonical: "/community/byob-02/register" },
  robots: { index: false, follow: true },
  openGraph: {
    type: "website",
    title: "Register for BYOB Nº 02 — Ruined",
    description,
    url: "/community/byob-02/register",
  },
};

export default function BYOB02RegistrationPage() {
  const event = EVENTS.find((candidate) => candidate.id === BYOB_02_EVENT_KEY);
  if (!event) notFound();

  return (
    <main className="-mt-4 min-h-screen bg-[var(--color-bone)] px-4 pb-20 text-[var(--color-faded)] sm:-mt-6 sm:px-8 sm:pb-24">
      <div className="mx-auto max-w-[86rem]">
        <header className="pb-4 sm:pb-5">
          <Link
            href={`/community#${event.id}`}
            className="ui-heading inline-flex text-[0.58rem] uppercase tracking-[0.14em] transition-colors hover:text-[var(--color-poster)]"
          >
            ← BYOB Nº 02
          </Link>

          <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.48fr)] lg:items-end lg:gap-12">
            <div>
              <p className="ui-heading text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">
                Registration open
              </p>
              <h1 className="display mt-2 text-[clamp(3.7rem,8vw,7.25rem)] leading-[0.82]">
                {event.title}
              </h1>
            </div>

            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 font-sans text-sm">
              <div>
                <dt className="ui-heading text-[0.52rem] uppercase tracking-[0.13em] text-black/40">
                  Date
                </dt>
                <dd className="mt-1">
                  <time dateTime={event.dateTime}>{event.date}</time>
                </dd>
              </div>
              <div>
                <dt className="ui-heading text-[0.52rem] uppercase tracking-[0.13em] text-black/40">
                  Time
                </dt>
                <dd className="mt-1">{event.time}</dd>
              </div>
              <div className="col-span-2">
                <dt className="ui-heading text-[0.52rem] uppercase tracking-[0.13em] text-black/40">
                  Place
                </dt>
                <dd className="mt-1">{event.location}</dd>
              </div>
            </dl>
          </div>
        </header>

        <BYOBRegistrationForm />
      </div>
    </main>
  );
}
