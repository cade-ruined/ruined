import Image from "next/image";
import Link from "next/link";

import type { MemberHomeSnapshot } from "@/lib/membership/model";

const progressionLevels = ["Member", "Shaper", "Builder", "Author", "Partner"] as const;

const eyebrow =
  "font-[var(--font-body)] text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/58";
const handLabel =
  "[font-family:var(--font-cadehandy2)] text-[1.5rem] leading-none text-[var(--color-poster)] sm:text-[1.65rem]";
const quietLink =
  "inline-flex min-h-11 items-center font-[var(--font-body)] text-xs font-medium text-white/62 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]";

const stateLabels: Record<string, string> = {
  active: "Active",
  alumni: "Alumni",
  attention_required: "Attention required",
  cancelled: "Cancelled",
  cancellation_requested: "Cancellation requested",
  collecting: "Collecting",
  completed: "Complete",
  ended: "Ended",
  fulfilled: "Fulfilled",
  in_progress: "In progress",
  in_production: "In production",
  inactive: "Inactive",
  not_started: "Not started",
  pending: "Pending",
  pre_active: "Preparing access",
  suspended: "Suspended",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatMonthYear(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatEventDate(value: string, timezone: string | null) {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    timeZoneName: "short",
    weekday: "long",
    year: "numeric",
  };
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(new Date(value));
  }
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function MemberPortrait({ member }: { member: MemberHomeSnapshot }) {
  return (
    <figure className="relative aspect-square w-full max-w-40 min-w-0 overflow-hidden rounded-[4px] bg-white/[0.035] min-[480px]:max-w-none">
      {member.avatarUrl ? (
        <Image
          alt=""
          className="object-cover"
          fill
          priority
          sizes="(min-width: 1024px) 38vw, (min-width: 480px) 176px, 160px"
          src={member.avatarUrl}
          unoptimized
        />
      ) : (
        <>
          <div aria-hidden="true" className="absolute inset-[7%] border border-white/12" />
          <div aria-hidden="true" className="absolute bottom-0 left-[18%] top-0 w-px bg-white/[0.08]" />
          <div aria-hidden="true" className="absolute bottom-[18%] left-0 right-0 h-px bg-white/[0.08]" />
          <Image
            alt=""
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 h-auto w-[30%] -translate-x-1/2 -translate-y-1/2 opacity-65"
            height={160}
            priority
            src="/favicon-ruined-mark-v2.svg"
            width={160}
          />
          <figcaption className="absolute bottom-[7%] right-[7%] font-[var(--font-body)] text-xs text-white/58">
            Portrait not added
          </figcaption>
        </>
      )}
    </figure>
  );
}

function PersonAvatar({
  person,
  size = "regular",
}: {
  person: MemberHomeSnapshot["circleMembers"][number];
  size?: "regular" | "small";
}) {
  const sizeClass = size === "small" ? "size-9" : "size-11";
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-white/25 bg-white/[0.07] ${sizeClass}`}
    >
      {person.avatarUrl ? (
        <Image
          alt=""
          className="object-cover"
          fill
          sizes={size === "small" ? "36px" : "44px"}
          src={person.avatarUrl}
          unoptimized
        />
      ) : (
        <span aria-hidden="true" className="font-[var(--font-body)] text-[0.65rem] font-medium text-white/72">
          {initials(person.displayName) || "R"}
        </span>
      )}
      <span className="sr-only">{person.displayName}</span>
    </span>
  );
}

function MembershipFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-[var(--font-body)] text-xs text-white/55">{label}</dt>
      <dd className="mt-2 break-words font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em] text-white/88">
        {value}
      </dd>
    </div>
  );
}

function ProfileState({ state }: { state: string }) {
  const attention = state === "attention_required" || state === "ended" || state === "suspended";
  const complete = state === "active" || state === "completed" || state === "fulfilled";
  return (
    <span className="inline-flex items-center gap-2 font-[var(--font-body)] text-sm text-white/76">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 ${
          attention
            ? "bg-[var(--color-poster)]"
            : complete
              ? "bg-[var(--color-verdigris)]"
              : "bg-white/45"
        }`}
      />
      {stateLabels[state] ?? state.replaceAll("_", " ")}
    </span>
  );
}

function historyFor(member: MemberHomeSnapshot) {
  const entries: Array<{
    date: string;
    detail: string;
    id: string;
    title: string;
    verb: string;
  }> = [];

  for (const artifact of member.artifacts) {
    entries.push({
      date: artifact.earnedAt,
      detail: artifact.earnedReason,
      id: `artifact-${artifact.awardId}`,
      title: artifact.name,
      verb: "Earned",
    });
  }

  if (member.foundations.requirements.futureLetter.completedAt) {
    entries.push({
      date: member.foundations.requirements.futureLetter.completedAt,
      detail: "Private completion recorded.",
      id: "future-letter",
      title: "Future Letter",
      verb: "Completed",
    });
  }

  if (member.foundations.requirements.timeline.completedAt) {
    entries.push({
      date: member.foundations.requirements.timeline.completedAt,
      detail: `${member.foundations.requirements.timeline.entryCount} timeline ${
        member.foundations.requirements.timeline.entryCount === 1 ? "entry" : "entries"
      }`,
      id: "ruined-timeline",
      title: "Ruined Timeline",
      verb: "Completed",
    });
  }

  if (member.memberSince) {
    entries.push({
      date: member.memberSince,
      detail: "Membership started.",
      id: "membership-began",
      title: "Ruined",
      verb: "Joined",
    });
  }

  return entries
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 7);
}

function nextActionLabel(kind: MemberHomeSnapshot["nextAction"]["kind"]) {
  switch (kind) {
    case "onboarding":
      return "Finish membership entry";
    case "account":
    case "billing":
      return "Review membership";
    case "timeline":
      return "Open the Timeline";
    case "foundations":
      return "Continue Foundations";
    case "circle":
      return "Open Circle";
    case "artifact":
      return "Open Artifacts";
    case "updates":
      return "Read Updates";
    case "experience":
      return "View experience";
  }
}

function registrationLabel(value: MemberHomeSnapshot["upcomingExperiences"][number]["registrationState"]) {
  switch (value) {
    case "registered":
      return "Registered";
    case "waitlisted":
      return "Waitlisted";
    case "external":
      return "External registration";
    case "cancelled":
      return "Cancelled";
    default:
      return "No registration required";
  }
}

export default function MemberHome({ member }: { member: MemberHomeSnapshot }) {
  const preferredName =
    member.profile.preferredName || (member.displayName === "Member" ? null : member.displayName);
  const greeting = preferredName ? `Welcome, ${preferredName}.` : "Welcome.";
  const profileName = member.profile.fullName?.trim() || member.profile.displayName;
  const foundationPercent = Math.max(0, Math.min(100, Math.round(member.foundations.progressPercent)));
  const foundationComplete = member.foundations.state === "completed";
  const workReachedHundred = foundationPercent >= 100 && !foundationComplete;
  const circleGateOutstanding =
    workReachedHundred && !member.foundations.requirements.activeCircle.completed;
  const foundationHeading = foundationComplete
    ? "Complete"
    : workReachedHundred
      ? "Work complete"
      : `${foundationPercent}% complete`;
  const foundationValueText = foundationComplete
    ? "Foundations complete"
    : circleGateOutstanding
      ? "All Foundations work complete. An active Circle is still required."
      : workReachedHundred
        ? "Foundations work complete. Final completion is pending."
        : `Foundations ${foundationPercent}% complete`;
  const history = historyFor(member);
  const requirementSteps = [
    {
      complete: member.foundations.requirements.timeline.completed,
      label: "Timeline",
    },
    {
      complete:
        member.foundations.requirements.moments.completed >=
        member.foundations.requirements.moments.total,
      label: `${member.foundations.requirements.moments.completed}/${member.foundations.requirements.moments.total} moments`,
    },
    {
      complete: member.foundations.requirements.futureLetter.completed,
      label: "Future Letter",
    },
    {
      complete: member.foundations.requirements.activeCircle.completed,
      label: "Active Circle",
    },
  ];
  const firstIncompleteRequirement = requirementSteps.findIndex((step) => !step.complete);

  return (
    <main className="mx-auto max-w-[86rem] pb-24 sm:pb-28">
      <header>
        <h1 className="ui-heading max-w-fit break-words bg-[var(--color-highlight)] px-[0.22em] py-[0.14em] text-[clamp(2.15rem,5.8vw,5.2rem)] uppercase leading-[0.9] tracking-[-0.045em] text-[#080605]">
          {greeting}
        </h1>

        <div className="mt-8 grid gap-x-5 gap-y-8 min-[360px]:grid-cols-[7.5rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-8 lg:mt-12 lg:grid-cols-[minmax(22rem,0.76fr)_minmax(0,1.24fr)] lg:gap-x-16">
          <div className="lg:row-span-2">
            <MemberPortrait member={member} />
          </div>

          <div className="min-w-0 self-end">
            <p className={eyebrow}>{member.progression.name}</p>
            <h2 className="mt-3 break-words font-[var(--font-display)] text-[clamp(2.5rem,7vw,7.2rem)] uppercase leading-[0.86] tracking-[-0.052em] text-[var(--color-bone)]">
              {profileName}
            </h2>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-[var(--font-body)] text-sm text-white/62">
              <ProfileState state={member.identity.standingState} />
              {member.profile.location ? <span>{member.profile.location}</span> : null}
              {member.memberSince ? <span>Joined {formatMonthYear(member.memberSince)}</span> : null}
            </div>
          </div>

          <div className="min-w-0 min-[360px]:col-span-2 lg:col-span-1 lg:col-start-2">
            <div className="max-w-3xl border-l border-[var(--color-poster)]/70 pl-5 sm:pl-7">
              <p className={handLabel}>what I’m building</p>
              <p className="mt-4 font-[var(--font-body)] text-base leading-relaxed text-white/78">
                {member.profile.buildingNow ?? "Not added."}
              </p>
              {member.profile.bio ? (
                <p className="mt-4 font-[var(--font-body)] text-sm leading-relaxed text-white/58 sm:text-base">
                  {member.profile.bio}
                </p>
              ) : null}
            </div>
            <Link className={`${quietLink} mt-6 underline decoration-white/25 underline-offset-8`} href="/my/profile">
              Edit profile
            </Link>
          </div>
        </div>

        <dl className="mt-9 grid gap-7 border-y border-white/12 py-7 min-[360px]:grid-cols-3 min-[360px]:gap-5 sm:gap-8 lg:ml-[calc(38%+4rem)]">
          <MembershipFact label="Foundations" value={`${foundationPercent}%`} />
          <MembershipFact label="Artifacts earned" value={String(member.artifacts.length)} />
          <MembershipFact label="Upcoming" value={String(member.upcomingExperiences.length)} />
        </dl>
      </header>

      {member.access.reason ? (
        <aside
          aria-label="Membership access"
          className="mt-10 max-w-3xl border-l-2 border-[var(--color-poster)] px-5 py-1 font-[var(--font-body)] text-sm leading-relaxed text-white/72"
        >
          {member.access.reason}
        </aside>
      ) : null}

      <section
        aria-labelledby="member-next-action"
        className="mt-14 grid gap-7 border-y border-white/12 py-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
      >
        <div>
          <p className={eyebrow}>Next</p>
          <h2
            className="mt-4 max-w-4xl font-[var(--font-display)] text-[clamp(2.5rem,5vw,4.8rem)] leading-[0.9] tracking-[-0.042em]"
            id="member-next-action"
          >
            {member.nextAction.title}
          </h2>
          <p className="mt-5 max-w-2xl font-[var(--font-body)] text-sm leading-relaxed text-white/58 sm:text-base">
            {member.nextAction.body}
          </p>
        </div>
        <Link
          className="inline-flex min-h-12 w-fit items-center bg-[var(--color-bone)] px-6 font-[var(--font-body)] text-xs font-semibold uppercase tracking-[0.13em] text-[#080605] transition-colors hover:bg-[var(--color-poster)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
          href={member.nextAction.href}
        >
          {nextActionLabel(member.nextAction.kind)} <span aria-hidden="true" className="ml-5">→</span>
        </Link>
      </section>

      <section aria-labelledby="your-place-title" className="mt-20 sm:mt-24">
        <h2
          className="font-[var(--font-display)] text-[clamp(2.9rem,6vw,5.5rem)] leading-[0.9] tracking-[-0.045em]"
          id="your-place-title"
        >
          Your place.
        </h2>

        <div className="mt-10 grid gap-x-10 gap-y-12 md:grid-cols-2 xl:grid-cols-4">
          <article aria-labelledby="foundations-summary-title" className="min-w-0 border-t border-white/18 pt-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className={eyebrow}>Foundations</p>
                <h3 className="mt-4 font-[var(--font-display)] text-3xl tracking-[-0.03em]" id="foundations-summary-title">
                  {foundationHeading}
                </h3>
              </div>
              <Link className={quietLink} href="/my/foundations">
                View →
              </Link>
            </div>
            {circleGateOutstanding ? (
              <p className="mt-3 font-[var(--font-body)] text-xs leading-relaxed text-white/62">
                Active Circle required to complete Foundations.
              </p>
            ) : null}
            <div
              aria-label={foundationValueText}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={foundationPercent}
              aria-valuetext={foundationValueText}
              className="mt-6 h-1.5 overflow-hidden bg-white/12"
              role="progressbar"
            >
              <span
                className={`block h-full ${foundationComplete ? "bg-[var(--color-verdigris)]" : "bg-[var(--color-poster)]"}`}
                style={{ width: `${foundationPercent}%` }}
              />
            </div>
            <ol className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
              {requirementSteps.map((step, index) => {
                const current = firstIncompleteRequirement === index;
                const stepState = step.complete ? "Complete" : current ? "Current" : "Waiting";
                return (
                  <li aria-current={current ? "step" : undefined} className="min-w-0" key={step.label}>
                    <span className="font-[var(--font-body)] text-xs text-white/55">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p className="mt-1 break-words font-[var(--font-body)] text-xs text-white/78">
                      {step.label}
                    </p>
                    <p className="mt-2 inline-flex items-center gap-2 font-[var(--font-body)] text-[0.7rem] text-white/58">
                      <span
                        aria-hidden="true"
                        className={`size-1.5 ${step.complete ? "bg-[var(--color-verdigris)]" : current ? "bg-[var(--color-poster)]" : "bg-white/22"}`}
                      />
                      {stepState}
                    </p>
                  </li>
                );
              })}
            </ol>
          </article>

          <article aria-labelledby="circle-summary-title" className="min-w-0 border-t border-white/18 pt-6">
            <p className={eyebrow}>Circle</p>
            <h3 className="mt-4 font-[var(--font-display)] text-3xl tracking-[-0.03em]" id="circle-summary-title">
              {member.circleName ?? "Being formed"}
            </h3>
            {member.circleMembers.length > 0 ? (
              <>
                <ul aria-label="Circle members" className="mt-6 flex -space-x-2 overflow-hidden py-1">
                  {member.circleMembers.slice(0, 7).map((person) => (
                    <li key={person.id}><PersonAvatar person={person} /></li>
                  ))}
                </ul>
                <p className="mt-4 font-[var(--font-body)] text-sm text-white/62">
                  {member.circleMembers.length} {member.circleMembers.length === 1 ? "member" : "members"}
                </p>
              </>
            ) : (
              <p className="mt-6 font-[var(--font-body)] text-sm text-white/62">Not formed.</p>
            )}
            <Link className={`${quietLink} mt-5`} href="/my/circle">
              Open Circle →
            </Link>
          </article>

          <article aria-labelledby="partner-summary-title" className="min-w-0 border-t border-white/18 pt-6">
            <p className={eyebrow}>Accountability</p>
            <h3 className="mt-4 font-[var(--font-display)] text-3xl tracking-[-0.03em]" id="partner-summary-title">
              {member.partner?.displayName ?? "Not paired"}
            </h3>
            {member.partner ? (
              <div className="mt-6"><PersonAvatar person={member.partner} /></div>
            ) : null}
            <Link className={`${quietLink} mt-5`} href="/my/circle">
              Open Circle →
            </Link>
          </article>

          <article aria-labelledby="progression-summary-title" className="min-w-0 border-t border-white/18 pt-6">
            <p className={eyebrow}>Progression</p>
            <h3 className="mt-4 font-[var(--font-display)] text-3xl tracking-[-0.03em]" id="progression-summary-title">
              {member.progression.name}
            </h3>
            <ol aria-label="Membership progression" className="mt-6 grid grid-cols-5 gap-1">
              {progressionLevels.map((level, index) => {
                const reached = index + 1 < member.progression.position;
                const current = index + 1 === member.progression.position;
                const state = current ? "Current" : reached ? "Reached" : "Upcoming";
                return (
                  <li
                    aria-current={current ? "step" : undefined}
                    className="min-w-0 font-[var(--font-body)]"
                    key={level}
                  >
                    <span
                      aria-hidden="true"
                      className={`block h-1.5 ${current ? "bg-[var(--color-poster)]" : reached ? "bg-[var(--color-verdigris)]" : "bg-white/15"}`}
                    />
                    <span className={`mt-2 block truncate text-[0.62rem] ${current ? "text-white" : "text-white/64"}`}>
                      {level}
                    </span>
                    <span className="mt-1 block truncate text-[0.56rem] text-white/52">
                      {state}
                    </span>
                  </li>
                );
              })}
            </ol>
          </article>
        </div>
      </section>

      <div className="mt-20 grid gap-16 border-t border-white/12 pt-10 sm:mt-24 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] lg:gap-16">
        <section aria-labelledby="history-title">
          <h2 className="font-[var(--font-display)] text-4xl tracking-[-0.035em] sm:text-5xl" id="history-title">
            Ruined history.
          </h2>
          {history.length > 0 ? (
            <ol className="relative mt-9 space-y-8 before:absolute before:bottom-2 before:left-[0.28rem] before:top-2 before:w-px before:bg-white/12">
              {history.map((entry) => (
                <li className="relative grid grid-cols-[0.6rem_minmax(0,1fr)] gap-5" key={entry.id}>
                  <span aria-hidden="true" className="relative z-10 mt-1.5 size-2.5 rounded-full border-2 border-[#080605] bg-[var(--color-poster)]" />
                  <article>
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-[var(--font-body)] text-xs">
                      <time className="text-white/55" dateTime={entry.date}>{formatDate(entry.date)}</time>
                      <span className="text-white/65">{entry.verb}</span>
                    </div>
                    <h3 className="mt-2 font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em]">{entry.title}</h3>
                    <p className="mt-2 font-[var(--font-body)] text-sm leading-relaxed text-white/58">{entry.detail}</p>
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-8 font-[var(--font-body)] text-sm text-white/58">No history recorded yet.</p>
          )}
        </section>

        <div className="space-y-16">
          <section aria-labelledby="artifacts-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-[var(--font-display)] text-4xl tracking-[-0.035em] sm:text-5xl" id="artifacts-title">
                Artifacts.
              </h2>
              <Link className={quietLink} href="/my/artifacts">
                View all →
              </Link>
            </div>
            {member.artifacts.length > 0 ? (
              <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 xl:grid-cols-3 xl:gap-x-5">
                {member.artifacts.slice(0, 3).map((artifact, index) => (
                  <li key={artifact.awardId}>
                    <article>
                      <div className="relative aspect-square overflow-hidden rounded-[4px] bg-white/[0.045]">
                        {artifact.imageUrl ? (
                          <Image alt="" className="object-cover" fill sizes="(min-width: 1280px) 18vw, 40vw" src={artifact.imageUrl} unoptimized />
                        ) : (
                          <div className="absolute inset-0 grid place-items-center">
                            <div aria-hidden="true" className="absolute inset-[8%] border border-white/12" />
                            <Image alt="" aria-hidden="true" className="h-auto w-[22%] opacity-55" height={72} src="/favicon-ruined-mark-v2.svg" width={72} />
                            <span aria-hidden="true" className="absolute left-[8%] top-[8%] font-[var(--font-body)] text-xs text-white/48">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                          </div>
                        )}
                      </div>
                      <h3 className="mt-4 font-[var(--font-display)] text-xl leading-none tracking-[-0.025em] sm:text-2xl">{artifact.name}</h3>
                      <p className="mt-2 font-[var(--font-body)] text-xs text-white/58">
                        Earned <time dateTime={artifact.earnedAt}>{formatDate(artifact.earnedAt)}</time>
                      </p>
                      <div className="mt-4"><ProfileState state={artifact.artifactState} /></div>
                    </article>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-8 border-y border-white/12 py-6 font-[var(--font-body)] text-sm text-white/62">
                No artifacts yet.
              </p>
            )}
          </section>

          <section aria-labelledby="experiences-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-[var(--font-display)] text-4xl tracking-[-0.035em] sm:text-5xl" id="experiences-title">
                Upcoming experiences.
              </h2>
              <Link className={quietLink} href="/my/experiences">
                View all →
              </Link>
            </div>
            {member.upcomingExperiences.length > 0 ? (
              <ol className="mt-7 divide-y divide-white/12">
                {member.upcomingExperiences.slice(0, 3).map((experience) => (
                  <li className="py-6 first:pt-0" key={experience.id}>
                    <article>
                      <h3 className="font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em]">{experience.title}</h3>
                      <time className="mt-3 block font-[var(--font-body)] text-xs leading-relaxed text-white/62" dateTime={experience.startsAt}>
                        {formatEventDate(experience.startsAt, member.profile.timezone)}
                        {experience.locationLabel ? ` · ${experience.locationLabel}` : ""}
                      </time>
                      <p className="mt-3 font-[var(--font-body)] text-sm text-white/62">
                        {experience.audienceLabel} · {registrationLabel(experience.registrationState)}
                      </p>
                    </article>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-8 border-y border-white/12 py-6 font-[var(--font-body)] text-sm text-white/62">
                Nothing scheduled.
              </p>
            )}
          </section>
        </div>
      </div>

      <section aria-labelledby="member-information-title" className="mt-20 border-t border-white/12 pt-10 sm:mt-24">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className={eyebrow}>Private to you</p>
            <h2 className="mt-4 font-[var(--font-display)] text-4xl tracking-[-0.035em] sm:text-5xl" id="member-information-title">
              Profile details.
            </h2>
          </div>
          <Link className={`${quietLink} underline decoration-white/25 underline-offset-8`} href="/my/profile">
            Edit information
          </Link>
        </div>
        <dl className="mt-9 grid gap-x-8 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
          <MembershipFact label="Email" value={member.identity.email} />
          <MembershipFact label="Location" value={member.profile.location ?? "Not shared"} />
          <MembershipFact label="Timezone" value={member.profile.timezone ?? "Not added"} />
          <MembershipFact label="Circle profile" value={member.profile.directoryStatus === "circle_visible" ? "Visible" : "Private"} />
          <MembershipFact label="Block" value={member.blockName ?? "Not formed"} />
          <MembershipFact label="Member since" value={member.memberSince ? formatMonthYear(member.memberSince) : "Not recorded"} />
        </dl>
      </section>
    </main>
  );
}
