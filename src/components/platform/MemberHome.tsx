import Link from "next/link";

import EditorialImagePlaceholder from "@/components/platform/EditorialImagePlaceholder";
import StateLabel from "@/components/platform/StateLabel";
import type { MemberHomeSnapshot } from "@/lib/membership/model";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function QuietLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      className="font-[var(--font-body)] text-[0.66rem] font-medium uppercase tracking-[0.15em] text-black/50 underline decoration-black/25 underline-offset-8 transition-colors hover:text-black"
      href={href}
    >
      {label}
    </Link>
  );
}

export default function MemberHome({ member }: { member: MemberHomeSnapshot }) {
  const rooms = [
    {
      body: member.circleName
        ? `${member.circleName} is the group closest to your work.`
        : "Your people will appear here when Ruined forms your Circle.",
      href: "/my/circle",
      meta: member.circleName ?? "Being formed",
      title: "Circle",
    },
    {
      body: "The shared beginning—and the private tools that stay useful afterward.",
      href: "/my/foundations",
      meta: `${Math.round(member.foundations.progressPercent)}% complete`,
      title: "Foundations",
    },
    {
      body: member.nextExperience
        ? member.nextExperience.summary ?? "The next place to gather."
        : "Member gatherings will live here when they are announced.",
      href: "/my/experiences",
      meta: member.nextExperience
        ? formatDate(member.nextExperience.startsAt)
        : "Nothing scheduled",
      title: "Experiences",
    },
    {
      body: "Working notes, field guides, films, and material worth returning to.",
      href: "/my/learn",
      meta: "Member library",
      title: "Learn",
    },
    {
      body: member.artifact
        ? member.artifact.earnedReason
        : "The physical record appears when something has been earned.",
      href: "/my/artifacts",
      meta: member.artifact
        ? member.artifact.artifactState.replaceAll("_", " ")
        : "No award yet",
      title: "Artifacts",
    },
    {
      body: "Announcements and personal notices, held in one quiet place.",
      href: "/my/updates",
      meta: member.unreadUpdates > 0 ? `${member.unreadUpdates} unread` : "All caught up",
      title: "Updates",
    },
  ];

  return (
    <main>
      <header className="grid items-end gap-10 border-t border-black/20 pt-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)] lg:gap-16">
        <div className="pb-2 lg:pb-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="font-[var(--font-body)] text-[0.68rem] font-medium uppercase tracking-[0.18em] text-black/55">
              Ruined Membership / Home
            </p>
            <StateLabel state={member.identity.billingState} />
          </div>
          <p className="mt-12 font-[var(--font-handwritten)] text-2xl leading-none text-[var(--color-poster)] sm:text-3xl">
            Members & Membership
          </p>
          <h1 className="mt-4 max-w-[12ch] font-[var(--font-display)] text-[clamp(3.8rem,9.5vw,9.5rem)] font-medium leading-[0.78] tracking-[-0.055em]">
            Do the next true thing.
          </h1>
          <p className="mt-8 max-w-xl font-[var(--font-body)] text-base leading-relaxed text-black/62 sm:text-lg">
            Welcome, {member.displayName}. This is the private home of your membership—the work in front of you, the people beside you, and what remains afterward.
          </p>
        </div>

        <EditorialImagePlaceholder
          intent="A member alone after the room clears. Natural light. Nothing performed."
          orientation="portrait"
          sequence="01"
        />
      </header>

      {member.access.reason ? (
        <section className="mt-10 border-l-2 border-[var(--color-poster)] bg-black/[0.025] px-5 py-4" role="status">
          <p className="font-[var(--font-body)] text-sm leading-relaxed text-black/65">
            {member.access.reason}
          </p>
        </section>
      ) : null}

      <section className="mt-16 grid bg-[#080605] text-[var(--color-bone)] lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-20">
          <p className="font-[var(--font-body)] text-[0.66rem] font-medium uppercase tracking-[0.18em] text-[var(--color-poster)]">
            What comes next
          </p>
          <h2 className="mt-6 max-w-4xl font-[var(--font-display)] text-[clamp(2.6rem,6.5vw,6.2rem)] font-medium leading-[0.88] tracking-[-0.045em]">
            {member.nextAction.title}
          </h2>
          <p className="mt-7 max-w-2xl font-[var(--font-body)] text-base leading-relaxed text-white/52">
            {member.nextAction.body}
          </p>
          <Link
            className="mt-10 inline-flex min-h-12 items-center gap-8 border border-[var(--color-bone)] bg-[var(--color-bone)] px-6 font-[var(--font-body)] text-[0.68rem] font-medium uppercase tracking-[0.16em] text-[#171411] transition-colors hover:bg-transparent hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
            href={member.nextAction.href}
          >
            Continue <span aria-hidden>→</span>
          </Link>
        </div>

        <div className="border-t border-white/15 px-6 py-9 sm:px-10 lg:border-l lg:border-t-0 lg:px-10 lg:py-14">
          <p className="font-[var(--font-handwritten)] text-2xl text-[var(--color-poster)]">
            your place here
          </p>
          <dl className="mt-7 border-t border-white/15 font-[var(--font-body)]">
            {[
              ["Progression", member.progression.name],
              ["Circle", member.circleName ?? "Being formed"],
              ["Block", member.blockName ?? "Not formed yet"],
              ["Foundations", member.foundations.state.replaceAll("_", " ")],
            ].map(([label, value]) => (
              <div className="border-b border-white/15 py-5 last:border-b-0" key={label}>
                <dt className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-white/38">
                  {label}
                </dt>
                <dd className="mt-2 text-base capitalize text-white/78">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mt-20" aria-labelledby="membership-rooms-title">
        <div className="grid gap-6 border-b border-black/20 pb-8 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="font-[var(--font-body)] text-[0.66rem] font-medium uppercase tracking-[0.18em] text-[var(--color-poster)]">
              Inside membership
            </p>
            <h2
              className="mt-4 font-[var(--font-display)] text-[clamp(2.8rem,6vw,5.5rem)] font-medium leading-[0.9] tracking-[-0.04em]"
              id="membership-rooms-title"
            >
              The rooms that hold the work.
            </h2>
          </div>
          <QuietLink href="/my/profile" label="Your profile" />
        </div>

        <ol>
          {rooms.map((room, index) => (
            <li className="border-b border-black/20" key={room.href}>
              <Link
                className="group grid gap-5 py-8 transition-colors hover:bg-black/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-poster)] sm:grid-cols-[3rem_minmax(10rem,0.48fr)_minmax(0,1fr)_auto] sm:items-start sm:gap-8 sm:px-2 sm:py-10"
                href={room.href}
              >
                <span className="font-[var(--font-body)] text-[0.62rem] tracking-[0.12em] text-black/35">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="font-[var(--font-display)] text-3xl font-medium leading-none tracking-[-0.03em] sm:text-4xl">
                  {room.title}
                </h3>
                <div>
                  <p className="font-[var(--font-body)] text-[0.62rem] font-medium uppercase tracking-[0.14em] text-[var(--color-poster)]">
                    {room.meta}
                  </p>
                  <p className="mt-3 max-w-xl font-[var(--font-body)] text-sm leading-relaxed text-black/56 sm:text-base">
                    {room.body}
                  </p>
                </div>
                <span aria-hidden className="text-xl text-black/35 transition-transform group-hover:translate-x-1 group-hover:text-black">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20 grid gap-8 border-y border-black/20 py-10 lg:grid-cols-3 lg:gap-12 lg:py-14">
        <div>
          <p className="font-[var(--font-body)] text-[0.62rem] uppercase tracking-[0.16em] text-black/38">
            Next Circle room
          </p>
          <p className="mt-4 font-[var(--font-display)] text-3xl leading-none tracking-[-0.025em]">
            {member.nextMeeting ? member.nextMeeting.title : "Not scheduled"}
          </p>
          {member.nextMeeting ? (
            <p className="mt-3 font-[var(--font-body)] text-sm text-black/48">
              {formatDate(member.nextMeeting.startsAt)}
            </p>
          ) : null}
        </div>
        <div>
          <p className="font-[var(--font-body)] text-[0.62rem] uppercase tracking-[0.16em] text-black/38">
            Accountability
          </p>
          <p className="mt-4 font-[var(--font-display)] text-3xl leading-none tracking-[-0.025em]">
            {member.partner?.displayName ?? "Not paired yet"}
          </p>
          <div className="mt-5"><QuietLink href="/my/circle" label="Open Circle" /></div>
        </div>
        <div>
          <p className="font-[var(--font-body)] text-[0.62rem] uppercase tracking-[0.16em] text-black/38">
            Latest word
          </p>
          <p className="mt-4 font-[var(--font-display)] text-3xl leading-none tracking-[-0.025em]">
            {member.announcement?.title ?? "Nothing new"}
          </p>
          {member.announcement ? (
            <div className="mt-5"><QuietLink href="/my/updates" label="Read update" /></div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
