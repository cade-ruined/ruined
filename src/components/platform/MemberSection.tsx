import Link from "next/link";

import EditorialImagePlaceholder from "@/components/platform/EditorialImagePlaceholder";
import StateLabel from "@/components/platform/StateLabel";
import type { MemberPlatformSnapshot } from "@/lib/platform/model";

const CONTENT = {
  account: {
    eyebrow: "Membership details",
    title: "Account",
    text: "The practical side of belonging: your verified identity, membership standing, privacy, and billing access.",
    intent: "An unguarded portrait with room around the person. Quiet, direct, no status symbols.",
  },
  artifacts: {
    eyebrow: "What remains",
    title: "Artifacts",
    text: "The physical record of the work—made from what you choose to name, keep, and carry forward.",
    intent: "A finished object beside the marks of its making. Tactile, worn, and honestly lit.",
  },
  circle: {
    eyebrow: "The people closest to the work",
    title: "Circle",
    text: "Your Circle is the immediate group that sees the work closely. When several Circles are brought together, that wider body becomes a Block.",
    intent: "A room in the moment after someone speaks. Faces attentive, composition loose, no staged unity.",
  },
  foundations: {
    eyebrow: "SEE · CONFRONT · CUT · GROW",
    title: "Foundations",
    text: "The beginning of membership: a deliberate passage through what is true, what must be faced, what can be removed, and what deserves to grow.",
    intent: "A solitary working surface mid-process. Notes, decisions, negative space, morning light.",
  },
} as const;

type MemberSectionName = keyof typeof CONTENT;

function CircleBelonging({ member }: { member: MemberPlatformSnapshot }) {
  const levels = [
    {
      label: "Member",
      note: "The individual",
      value: member.name,
    },
    {
      label: "Circle",
      note: "The immediate group",
      value: member.circleName ?? "Assignment in progress",
    },
    {
      label: "Block",
      note: "Several Circles together",
      value:
        member.blockName ??
        (member.circleName
          ? "Appears here when your Circle is joined with others"
          : "Formed after Circle assignment"),
    },
  ] as const;

  return (
    <section
      aria-labelledby="belonging-title"
      className="mt-20 bg-[#080605] px-6 py-10 text-[var(--color-bone)] sm:px-10 sm:py-14 lg:px-14 lg:py-16"
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)] lg:gap-20">
        <div>
          <p className="font-[var(--font-handwritten)] text-3xl leading-none text-[var(--color-poster)]">
            closest first
          </p>
          <h2
            className="mt-5 max-w-sm font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.8rem)] font-medium leading-[0.9] tracking-[-0.04em]"
            id="belonging-title"
          >
            How belonging is held.
          </h2>
          <p className="mt-6 max-w-sm font-[var(--font-body)] text-sm leading-relaxed text-white/52">
            A Block is context, not another task. Your Circle remains the place you return to most often.
          </p>
        </div>

        <ol className="border-t border-white/18">
          {levels.map((level, index) => (
            <li
              className="grid gap-3 border-b border-white/18 py-6 sm:grid-cols-[2.5rem_minmax(7rem,0.55fr)_minmax(0,1fr)] sm:items-baseline sm:gap-6 sm:py-7"
              key={level.label}
            >
              <span className="font-[var(--font-body)] text-[0.6rem] tracking-[0.12em] text-white/32">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-[var(--font-display)] text-2xl font-medium tracking-[-0.025em]">
                  {level.label}
                </h3>
                <p className="mt-1 font-[var(--font-body)] text-[0.62rem] uppercase tracking-[0.13em] text-white/35">
                  {level.note}
                </p>
              </div>
              <p className="font-[var(--font-body)] text-sm leading-relaxed text-white/68 sm:text-base">
                {level.value}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function AccountDetails({ member }: { member: MemberPlatformSnapshot }) {
  const canOpenBilling = member.billingState !== "pending";

  return (
    <section className="mt-20 border-t border-black/20" aria-labelledby="account-details-title">
      <div className="grid gap-8 py-10 md:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1.35fr)] md:gap-16 md:py-14">
        <div>
          <p className="font-[var(--font-handwritten)] text-2xl text-[var(--color-poster)]">
            yours to manage
          </p>
          <h2
            className="mt-4 font-[var(--font-display)] text-4xl font-medium tracking-[-0.035em]"
            id="account-details-title"
          >
            Membership details
          </h2>
        </div>
        <div>
          <dl className="border-t border-black/20 font-[var(--font-body)]">
            <div className="grid gap-2 border-b border-black/20 py-5 sm:grid-cols-[9rem_1fr] sm:items-baseline">
              <dt className="text-[0.63rem] font-medium uppercase tracking-[0.15em] text-black/40">
                Member
              </dt>
              <dd className="text-base text-black/72">{member.name}</dd>
            </div>
            <div className="grid gap-2 border-b border-black/20 py-5 sm:grid-cols-[9rem_1fr] sm:items-baseline">
              <dt className="text-[0.63rem] font-medium uppercase tracking-[0.15em] text-black/40">
                Verified email
              </dt>
              <dd className="break-all text-base text-black/72">{member.email}</dd>
            </div>
            <div className="grid gap-2 border-b border-black/20 py-5 sm:grid-cols-[9rem_1fr] sm:items-baseline">
              <dt className="text-[0.63rem] font-medium uppercase tracking-[0.15em] text-black/40">
                Standing
              </dt>
              <dd><StateLabel state={member.billingState} /></dd>
            </div>
          </dl>

          {canOpenBilling ? (
            <form action="/api/stripe/portal" method="post">
              <button
                className="mt-8 inline-flex min-h-12 items-center justify-center bg-[#080605] px-6 font-[var(--font-body)] text-[0.67rem] font-medium uppercase tracking-[0.15em] text-[var(--color-bone)] transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
                type="submit"
              >
                Manage billing securely
              </button>
            </form>
          ) : (
            <Link
              className="mt-8 inline-flex min-h-12 items-center justify-center bg-[#080605] px-6 font-[var(--font-body)] text-[0.67rem] font-medium uppercase tracking-[0.15em] text-[var(--color-bone)] transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
              href="/my/join"
            >
              Continue membership entry
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function SectionStanding({
  member,
  section,
  state,
}: {
  member: MemberPlatformSnapshot;
  section: MemberSectionName;
  state: string;
}) {
  if (section === "account" || section === "circle") return null;

  return (
    <section className="mt-20 border-y border-black/20 py-8 sm:py-10" aria-label="Current standing">
      <div className="grid gap-5 sm:grid-cols-[minmax(9rem,0.45fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10">
        <p className="font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.16em] text-black/40">
          Current standing
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <StateLabel state={state} />
          {section === "foundations" ? (
            <p className="font-[var(--font-body)] text-sm text-black/55">
              {member.foundationsProgress}% complete
            </p>
          ) : (
            <p className="max-w-xl font-[var(--font-body)] text-sm leading-relaxed text-black/55">
              New work will appear here when it is ready to be held.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function MemberSection({
  member,
  section,
}: {
  member: MemberPlatformSnapshot;
  section: MemberSectionName;
}) {
  const content = CONTENT[section];
  const state =
    section === "account"
      ? member.accountState
      : section === "artifacts"
        ? member.artifactState
        : section === "foundations"
          ? member.foundationsState
          : member.circleStatus ?? "pending";

  return (
    <main className="min-h-[68vh]">
      <header className="grid gap-10 border-t border-black/20 pt-5 lg:grid-cols-[minmax(0,1.04fr)_minmax(20rem,0.96fr)] lg:gap-16">
        <div className="flex min-w-0 flex-col pb-2 lg:pb-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="font-[var(--font-body)] text-[0.68rem] font-medium uppercase tracking-[0.18em] text-black/50">
              Ruined Membership / {content.title}
            </p>
            <StateLabel state={state} />
          </div>
          <div className="my-auto pt-14 lg:pt-20">
            <p className="font-[var(--font-body)] text-[0.66rem] font-medium uppercase tracking-[0.18em] text-[var(--color-poster)]">
              {content.eyebrow}
            </p>
            <h1 className="mt-5 font-[var(--font-display)] text-[clamp(4rem,10vw,9.5rem)] font-medium leading-[0.76] tracking-[-0.055em]">
              {content.title}
            </h1>
            <p className="mt-8 max-w-xl font-[var(--font-body)] text-base leading-relaxed text-black/60 sm:text-lg">
              {content.text}
            </p>
          </div>
        </div>

        <EditorialImagePlaceholder
          intent={content.intent}
          orientation="portrait"
          sequence="01"
        />
      </header>

      {section === "circle" ? <CircleBelonging member={member} /> : null}
      {section === "account" ? <AccountDetails member={member} /> : null}
      <SectionStanding member={member} section={section} state={state} />
    </main>
  );
}
