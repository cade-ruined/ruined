import Link from "next/link";

import EditorialImagePlaceholder from "@/components/platform/EditorialImagePlaceholder";
import StateLabel from "@/components/platform/StateLabel";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type { MemberPlatformSnapshot } from "@/lib/platform/model";

export default function MemberHome({
  member,
}: {
  configuration: PlatformConfiguration;
  member: MemberPlatformSnapshot;
}) {
  const active = member.billingState === "active";
  const destinations = [
    {
      href: "/my/foundations",
      label: "Foundations",
      state: member.foundationsState,
      text:
        member.foundationsProgress > 0
          ? "Continue the beginning from the place you last left it."
          : "Begin with SEE, then move through CONFRONT, CUT, and GROW.",
    },
    {
      href: "/my/circle",
      label: "Circle",
      state: member.circleStatus ?? "pending",
      text: member.circleName
        ? `${member.circleName} is the group closest to your work. ${member.blockName ? `${member.blockName} is the wider body around it.` : "Its wider Block will appear here when it is formed."}`
        : "Your immediate group, its people, and its gatherings will live here once your Circle is formed.",
    },
    {
      href: "/my/artifacts",
      label: "Artifacts",
      state: member.artifactState,
      text: "The physical record of what you choose to keep, make, and carry forward.",
    },
  ] as const;

  return (
    <main>
      <header className="grid items-end gap-10 border-t border-black/20 pt-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)] lg:gap-16">
        <div className="pb-2 lg:pb-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="font-[var(--font-body)] text-[0.68rem] font-medium uppercase tracking-[0.18em] text-black/55">
              Ruined Membership
            </p>
            <StateLabel state={member.billingState} />
          </div>
          <p className="mt-12 font-[var(--font-handwritten)] text-2xl leading-none text-[var(--color-poster)] sm:text-3xl">
            Members & Membership
          </p>
          <h1 className="mt-4 max-w-[12ch] font-[var(--font-display)] text-[clamp(3.8rem,9.5vw,9.5rem)] font-medium leading-[0.78] tracking-[-0.055em]">
            {active ? "Do the next true thing." : "Begin where you are."}
          </h1>
          <p className="mt-8 max-w-xl font-[var(--font-body)] text-base leading-relaxed text-black/62 sm:text-lg">
            Welcome, {member.name}. This is the private home of your membership—the work in front of you, the people beside you, and what remains afterward.
          </p>
        </div>

        <EditorialImagePlaceholder
          intent="A member alone after the room clears. Natural light. Nothing performed."
          orientation="portrait"
          sequence="01"
        />
      </header>

      <section className="mt-16 grid bg-[#080605] text-[var(--color-bone)] lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-20">
          <p className="font-[var(--font-body)] text-[0.66rem] font-medium uppercase tracking-[0.18em] text-[var(--color-poster)]">
            What comes next
          </p>
          <h2 className="mt-6 max-w-4xl font-[var(--font-display)] text-[clamp(2.6rem,6.5vw,6.2rem)] font-medium leading-[0.88] tracking-[-0.045em]">
            {member.nextAction}
          </h2>
          {member.billingState === "pending" || member.billingState === "ended" ? (
            <Link
              className="mt-10 inline-flex min-h-12 items-center justify-center bg-[var(--color-bone)] px-6 font-[var(--font-body)] text-[0.68rem] font-medium uppercase tracking-[0.16em] text-[#171411] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
              href="/my/join"
            >
              Continue membership entry
            </Link>
          ) : null}
        </div>

        <div className="border-t border-white/15 px-6 py-9 sm:px-10 lg:border-l lg:border-t-0 lg:px-10 lg:py-14">
          <p className="font-[var(--font-handwritten)] text-2xl text-[var(--color-poster)]">
            your place here
          </p>
          <dl className="mt-7 border-t border-white/15 font-[var(--font-body)]">
            <div className="border-b border-white/15 py-5">
              <dt className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-white/38">
                Member
              </dt>
              <dd className="mt-2 text-base text-white/78">{member.name}</dd>
            </div>
            <div className="border-b border-white/15 py-5">
              <dt className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-white/38">
                Circle
              </dt>
              <dd className="mt-2 text-base text-white/78">
                {member.circleName ?? "Being formed"}
              </dd>
            </div>
            <div className="border-b border-white/15 py-5">
              <dt className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-white/38">
                Block
              </dt>
              <dd className="mt-2 text-base text-white/78">
                {member.blockName ?? "Not formed yet"}
              </dd>
            </div>
            <div className="py-5">
              <dt className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-white/38">
                Standing
              </dt>
              <dd className="mt-2 text-base text-white/78">
                {active ? "Membership active" : "Entry in progress"}
              </dd>
            </div>
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
          <Link
            className="font-[var(--font-body)] text-[0.67rem] font-medium uppercase tracking-[0.15em] text-black/52 underline decoration-black/25 underline-offset-8 transition-colors hover:text-black"
            href="/my/account"
          >
            Membership details
          </Link>
        </div>

        <div>
          {destinations.map((item, index) => (
            <Link
              className="group grid gap-5 border-b border-black/20 py-8 transition-colors hover:bg-black/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-poster)] sm:grid-cols-[3rem_minmax(10rem,0.55fr)_minmax(0,1fr)_auto] sm:items-start sm:gap-8 sm:px-2 sm:py-10"
              href={item.href}
              key={item.href}
            >
              <span className="font-[var(--font-body)] text-[0.62rem] tracking-[0.12em] text-black/35">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="font-[var(--font-display)] text-3xl font-medium leading-none tracking-[-0.03em] sm:text-4xl">
                {item.label}
              </h3>
              <div>
                <StateLabel state={item.state} />
                <p className="mt-3 max-w-xl font-[var(--font-body)] text-sm leading-relaxed text-black/56 sm:text-base">
                  {item.text}
                </p>
              </div>
              <span
                aria-hidden="true"
                className="text-xl text-black/35 transition-transform group-hover:translate-x-1 group-hover:text-black"
              >
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-20 grid items-end gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(20rem,1.28fr)] lg:gap-16">
        <div className="pb-2">
          <p className="font-[var(--font-handwritten)] text-3xl leading-none text-[var(--color-poster)]">
            Leave evidence.
          </p>
          <p className="mt-5 max-w-md font-[var(--font-display)] text-3xl leading-[1.05] tracking-[-0.025em] sm:text-4xl">
            The work should become visible in how life is lived.
          </p>
        </div>
        <EditorialImagePlaceholder
          caption="Member record"
          intent="Hands, materials, and the trace of a decision. Close, imperfect, real."
          sequence="02"
        />
      </section>
    </main>
  );
}
