import Image from "next/image";
import Link from "next/link";

import type { MemberHomeSnapshot } from "@/lib/membership/model";

const progressionLevels = ["Member", "Shaper", "Builder", "Author", "Partner"] as const;

const eyebrow =
  "font-[var(--font-body)] text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-black/62";
const handLabel =
  "[font-family:var(--font-cadehandy2)] text-[1.5rem] leading-none text-[var(--color-poster)] sm:text-[1.65rem]";
const quietLink =
  "inline-flex min-h-11 items-center font-[var(--font-body)] text-xs font-semibold text-black/68 underline decoration-black/25 underline-offset-[0.38rem] transition-colors hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]";

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

function formatEventStamp(value: string, timezone: string | null) {
  const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      ...options,
      ...(timezone ? { timeZone: timezone } : {}),
    }).formatToParts(new Date(value));
    return {
      day: parts.find((part) => part.type === "day")?.value ?? "--",
      month: parts.find((part) => part.type === "month")?.value ?? "---",
    };
  } catch {
    const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(new Date(value));
    return {
      day: parts.find((part) => part.type === "day")?.value ?? "--",
      month: parts.find((part) => part.type === "month")?.value ?? "---",
    };
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
    <figure
      className="w-full bg-[#f4efe4] p-2 pb-7 shadow-[0_12px_28px_rgba(47,36,22,0.16)] ring-1 ring-black/18 sm:p-3 sm:pb-9"
      data-member-polaroid
    >
      <div className="relative aspect-square overflow-hidden bg-[#d8d0c2] ring-1 ring-black/12">
        {member.avatarUrl ? (
          <Image
            alt=""
            className="object-cover saturate-[0.86] contrast-[1.03]"
            fill
            priority
            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 192px, 112px"
            src={member.avatarUrl}
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(145deg,rgba(255,255,255,0.3),transparent_55%)]">
            <div aria-hidden="true" className="absolute inset-[7%] border border-black/12" />
            <Image
              alt=""
              aria-hidden="true"
              className="h-auto w-[32%] opacity-75"
              height={160}
              priority
              src="/favicon-ruined-mark-v2.svg"
              width={160}
            />
          </div>
        )}
      </div>
      <div
        aria-hidden={member.avatarUrl ? "true" : undefined}
        className="mt-2 flex min-h-4 items-center justify-between gap-2 font-[var(--font-body)] text-[0.58rem] uppercase tracking-[0.1em] text-black/58 sm:mt-3 sm:text-[0.65rem]"
      >
        <span>{member.avatarUrl ? "Member portrait" : "Portrait not added"}</span>
        {member.memberSince ? <span>{formatMonthYear(member.memberSince)}</span> : null}
      </div>
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
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-black/25 bg-black/[0.06] ${sizeClass}`}>
      {person.avatarUrl ? (
        <Image alt="" className="object-cover" fill sizes={size === "small" ? "36px" : "44px"} src={person.avatarUrl} unoptimized />
      ) : (
        <span aria-hidden="true" className="font-[var(--font-body)] text-[0.65rem] font-semibold text-black/72">
          {initials(person.displayName) || "R"}
        </span>
      )}
      <span className="sr-only">{person.displayName}</span>
    </span>
  );
}

function MembershipFact({
  className = "",
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="font-[var(--font-body)] text-xs font-medium text-black/62">{label}</dt>
      <dd className="mt-1.5 break-words font-[var(--font-display)] text-xl leading-none tracking-[-0.02em] text-black/88 sm:text-2xl">
        {value}
      </dd>
    </div>
  );
}

function GlanceFact({
  className = "",
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={`min-w-0 lg:flex lg:items-baseline lg:justify-between lg:gap-3 ${className}`}>
      <dt className="shrink-0 font-[var(--font-body)] text-[0.64rem] font-semibold uppercase tracking-[0.11em] text-black/58">{label}</dt>
      <dd className="mt-1 break-words font-[var(--font-body)] text-[0.82rem] font-semibold leading-snug text-black/82 lg:mt-0 lg:text-right">{value}</dd>
    </div>
  );
}

function ProfileState({ state }: { state: string }) {
  const attention = state === "attention_required" || state === "ended" || state === "suspended";
  const complete = state === "active" || state === "completed" || state === "fulfilled";
  return (
    <span className="inline-flex items-center gap-2 font-[var(--font-body)] text-sm font-medium text-black/72">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 ${attention ? "bg-[var(--color-poster)]" : complete ? "bg-[var(--color-verdigris)]" : "bg-black/45"}`}
      />
      {stateLabels[state] ?? state.replaceAll("_", " ")}
    </span>
  );
}

function historyFor(member: MemberHomeSnapshot) {
  const entries: Array<{ date: string; detail: string; id: string; title: string; verb: string }> = [];

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
      detail: `${member.foundations.requirements.timeline.entryCount} timeline ${member.foundations.requirements.timeline.entryCount === 1 ? "entry" : "entries"}`,
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
    case "onboarding": return "Finish membership entry";
    case "account":
    case "billing": return "Review membership";
    case "timeline": return "Open the Timeline";
    case "foundations": return "Continue Foundations";
    case "circle": return "Open Circle";
    case "artifact": return "Open Artifacts";
    case "updates": return "Read Updates";
    case "experience": return "View experience";
  }
}

function registrationLabel(value: MemberHomeSnapshot["upcomingExperiences"][number]["registrationState"]) {
  switch (value) {
    case "registered": return "Registered";
    case "waitlisted": return "Waitlisted";
    case "external": return "External registration";
    case "cancelled": return "Cancelled";
    default: return "No registration required";
  }
}

export default function MemberHome({ member }: { member: MemberHomeSnapshot }) {
  const preferredName = member.profile.preferredName || (member.displayName === "Member" ? null : member.displayName);
  const greeting = preferredName ? `Welcome, ${preferredName}.` : "Welcome.";
  const profileName = member.profile.fullName?.trim() || member.profile.displayName;
  const foundationPercent = Math.max(0, Math.min(100, Math.round(member.foundations.progressPercent)));
  const foundationComplete = member.foundations.state === "completed";
  const workReachedHundred = foundationPercent >= 100 && !foundationComplete;
  const circleGateOutstanding = workReachedHundred && !member.foundations.requirements.activeCircle.completed;
  const foundationHeading = foundationComplete ? "Complete" : workReachedHundred ? "Work complete" : `${foundationPercent}% complete`;
  const foundationValueText = foundationComplete
    ? "Foundations complete"
    : circleGateOutstanding
      ? "All Foundations work complete. An active Circle is still required."
      : workReachedHundred
        ? "Foundations work complete. Final completion is pending."
        : `Foundations ${foundationPercent}% complete`;
  const history = historyFor(member);
  const requirementSteps = [
    { complete: member.foundations.requirements.timeline.completed, label: "Timeline" },
    {
      complete: member.foundations.requirements.moments.completed >= member.foundations.requirements.moments.total,
      label: `${member.foundations.requirements.moments.completed}/${member.foundations.requirements.moments.total} moments`,
    },
    { complete: member.foundations.requirements.futureLetter.completed, label: "Future Letter" },
    { complete: member.foundations.requirements.activeCircle.completed, label: "Active Circle" },
  ];
  const firstIncompleteRequirement = requirementSteps.findIndex((step) => !step.complete);

  return (
    <main className="member-profile-dossier mx-auto max-w-[88rem] border border-black/12 px-4 pb-24 pt-5 shadow-[0_26px_70px_rgba(30,22,13,0.16)] sm:px-7 sm:pb-28 sm:pt-7 lg:px-10 lg:pt-9" data-member-profile-dossier>
      <header className="pb-9 sm:pb-11">
        <h1 className="ui-heading inline-block max-w-full break-words bg-[var(--color-highlight)] px-[0.28em] py-[0.18em] text-[clamp(1.25rem,3.2vw,2.5rem)] uppercase leading-[0.94] tracking-[-0.035em] text-[#080605]">
          {greeting}
        </h1>

        <div className="mt-6 grid grid-cols-[5.75rem_minmax(0,1fr)] gap-x-4 gap-y-7 min-[360px]:grid-cols-[6.25rem_minmax(0,1fr)] sm:mt-8 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-7 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(20rem,1.18fr)_minmax(13.5rem,0.72fr)] lg:gap-x-7 lg:gap-y-8 xl:grid-cols-[minmax(18rem,0.84fr)_minmax(23rem,1.16fr)_minmax(16rem,0.68fr)] xl:gap-x-12">
          <div className="min-w-0 lg:row-span-2"><MemberPortrait member={member} /></div>

          <div className="min-w-0 self-end lg:col-start-2">
            <p className={eyebrow}>{member.progression.name}</p>
            <h2 className="mt-2 break-words font-[var(--font-display)] text-[clamp(1.85rem,6.3vw,5.9rem)] uppercase leading-[0.86] tracking-[-0.052em] text-[#1c1916] sm:mt-3">{profileName}</h2>
            <div className="mt-4 flex flex-col items-start gap-2 font-[var(--font-body)] text-xs leading-snug text-black/62 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 sm:text-sm">
              <ProfileState state={member.identity.standingState} />
              {member.profile.location ? <span>{member.profile.location}</span> : null}
              {member.memberSince ? <span>Joined {formatMonthYear(member.memberSince)}</span> : null}
            </div>
          </div>

          <div className="col-span-2 min-w-0 lg:col-span-1 lg:col-start-2">
            <p className="font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em] text-black/84 sm:text-3xl">{member.progression.name}</p>
            <div className="mt-5 max-w-2xl border-l-2 border-[var(--color-poster)] pl-4 sm:pl-5">
              <p className={handLabel}>what I’m building</p>
              <p className="mt-3 font-[var(--font-body)] text-sm leading-relaxed text-black/78 sm:text-base">{member.profile.buildingNow ?? "Not added."}</p>
              {member.profile.bio ? <p className="mt-3 font-[var(--font-body)] text-sm leading-relaxed text-black/62 sm:text-base">{member.profile.bio}</p> : null}
            </div>
            <Link className={`${quietLink} mt-4`} href="/my/profile">Edit profile →</Link>
          </div>

          <aside className="col-span-2 border-t border-black/16 pt-6 lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0 xl:pl-10" aria-label="Membership at a glance">
            <p className={eyebrow}>At a glance</p>
            <dl className="mt-5 grid grid-cols-3 gap-x-4 gap-y-5 lg:grid-cols-1 lg:gap-3">
              <GlanceFact label="Foundations" value={`${foundationPercent}%`} />
              <GlanceFact className="hidden" label="Circle" value={member.circleName ?? "Not formed"} />
              <GlanceFact className="hidden" label="Accountability" value={member.partner?.displayName ?? "Not paired"} />
              <GlanceFact label="Artifacts" value={String(member.artifacts.length)} />
              <GlanceFact label="Upcoming" value={String(member.upcomingExperiences.length)} />
              {member.memberSince ? <GlanceFact className="hidden" label="Member since" value={formatMonthYear(member.memberSince)} /> : null}
            </dl>

            <section aria-labelledby="member-next-action" className="mt-5 border border-black/22 bg-[#eee7da]/70 p-4 sm:p-5">
              <p className={eyebrow}>Next</p>
              <h2 className="mt-3 font-[var(--font-display)] text-[1.5rem] leading-[0.95] tracking-[-0.03em] text-black/88" id="member-next-action">{member.nextAction.title}</h2>
              <p className="mt-3 font-[var(--font-body)] text-xs leading-relaxed text-black/62">{member.nextAction.body}</p>
              <Link className="mt-5 inline-flex min-h-11 items-center font-[var(--font-body)] text-xs font-semibold uppercase tracking-[0.09em] text-black/78 underline decoration-black/25 underline-offset-[0.38rem] transition-colors hover:text-[var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]" href={member.nextAction.href}>
                {nextActionLabel(member.nextAction.kind)} <span aria-hidden="true" className="ml-4">→</span>
              </Link>
            </section>
          </aside>
        </div>
      </header>

      {member.access.reason ? <aside aria-label="Membership access" className="mt-7 max-w-3xl border-l-2 border-[var(--color-poster)] px-4 py-1 font-[var(--font-body)] text-sm leading-relaxed text-black/68">{member.access.reason}</aside> : null}

      <section aria-labelledby="your-place-title" className="mt-11 sm:mt-14">
        <h2 className="sr-only" id="your-place-title">Your place.</h2>
        <div className="divide-y divide-black/16 border-y border-black/22 lg:grid lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <article aria-labelledby="foundations-summary-title" className="min-w-0 py-6 lg:px-6 lg:first:pl-0 xl:px-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={eyebrow}>Foundations</p>
                <h3 className="mt-3 font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em] text-black/88" id="foundations-summary-title">{foundationHeading}</h3>
              </div>
              <Link className={quietLink} href="/my/foundations">View →</Link>
            </div>
            {circleGateOutstanding ? <p className="mt-3 font-[var(--font-body)] text-xs leading-relaxed text-black/62">Active Circle required to complete Foundations.</p> : null}
            <div aria-label={foundationValueText} aria-valuemax={100} aria-valuemin={0} aria-valuenow={foundationPercent} aria-valuetext={foundationValueText} className="mt-5 h-1.5 overflow-hidden bg-black/14" role="progressbar">
              <span className={`block h-full ${foundationComplete ? "bg-[var(--color-verdigris)]" : "bg-[var(--color-poster)]"}`} style={{ width: `${foundationPercent}%` }} />
            </div>
            <ol className="mt-5 grid grid-cols-4 gap-2">
              {requirementSteps.map((step, index) => {
                const current = firstIncompleteRequirement === index;
                const stepState = step.complete ? "Complete" : current ? "Current" : "Waiting";
                return (
                  <li aria-current={current ? "step" : undefined} className="min-w-0" key={step.label}>
                    <span className="font-[var(--font-body)] text-[0.65rem] text-black/58">{String(index + 1).padStart(2, "0")}</span>
                    <p className="mt-1 break-words font-[var(--font-body)] text-[0.67rem] font-medium leading-tight text-black/74">{step.label}</p>
                    <p className="mt-2 inline-flex items-center gap-1.5 font-[var(--font-body)] text-[0.62rem] text-black/58">
                      <span aria-hidden="true" className={`size-1.5 ${step.complete ? "bg-[var(--color-verdigris)]" : current ? "bg-[var(--color-poster)]" : "bg-black/30"}`} />
                      {stepState}
                    </p>
                  </li>
                );
              })}
            </ol>
          </article>

          <article aria-labelledby="circle-summary-title" className="min-w-0 py-6 lg:px-6 xl:px-7">
            <p className={eyebrow}>Circle</p>
            <h3 className="mt-3 font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em] text-black/88" id="circle-summary-title">{member.circleName ?? "Being formed"}</h3>
            {member.circleMembers.length > 0 ? (
              <>
                <ul aria-label="Circle members" className="mt-5 flex -space-x-2 overflow-hidden py-1">{member.circleMembers.slice(0, 7).map((person) => <li key={person.id}><PersonAvatar person={person} /></li>)}</ul>
                <p className="mt-3 font-[var(--font-body)] text-sm text-black/62">{member.circleMembers.length} {member.circleMembers.length === 1 ? "member" : "members"}</p>
              </>
            ) : <p className="mt-5 font-[var(--font-body)] text-sm text-black/62">Not formed.</p>}
            <Link className={`${quietLink} mt-4`} href="/my/circle">Open Circle →</Link>
          </article>

          <article aria-labelledby="partner-summary-title" className="min-w-0 py-6 lg:px-6 xl:px-7">
            <p className={eyebrow}>Accountability</p>
            <h3 className="mt-3 font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em] text-black/88" id="partner-summary-title">{member.partner?.displayName ?? "Not paired"}</h3>
            {member.partner ? <div className="mt-5"><PersonAvatar person={member.partner} /></div> : null}
            <Link className={`${quietLink} mt-4`} href="/my/circle">Open Circle →</Link>
          </article>

          <article aria-labelledby="progression-summary-title" className="min-w-0 py-6 lg:px-6 lg:last:pr-0 xl:px-7">
            <p className={eyebrow}>Progression</p>
            <h3 className="mt-3 font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em] text-black/88" id="progression-summary-title">{member.progression.name}</h3>
            <ol aria-label="Membership progression" className="mt-5 grid grid-cols-5 gap-1">
              {progressionLevels.map((level, index) => {
                const reached = index + 1 < member.progression.position;
                const current = index + 1 === member.progression.position;
                const state = current ? "Current" : reached ? "Reached" : "Upcoming";
                return (
                  <li aria-current={current ? "step" : undefined} className="min-w-0 font-[var(--font-body)]" key={level}>
                    <span aria-hidden="true" className={`block h-1.5 ${current ? "bg-[var(--color-poster)]" : reached ? "bg-[var(--color-verdigris)]" : "bg-black/16"}`} />
                    <span className={`mt-2 block truncate text-[0.62rem] font-medium ${current ? "text-black" : "text-black/62"}`}>{level}</span>
                    <span className="mt-1 block truncate text-[0.58rem] text-black/58">{state}</span>
                  </li>
                );
              })}
            </ol>
          </article>
        </div>
      </section>

      <div className="mt-12 grid gap-12 sm:mt-14 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] lg:gap-14 xl:gap-16">
        <section aria-labelledby="history-title">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-[var(--font-display)] text-4xl tracking-[-0.035em] text-black/88" id="history-title">Ruined history.</h2>
            <span className={eyebrow}>{String(history.length).padStart(2, "0")} records</span>
          </div>
          {history.length > 0 ? (
            <ol className="relative mt-7 space-y-7 before:absolute before:bottom-2 before:left-[0.28rem] before:top-2 before:w-px before:bg-black/18">
              {history.map((entry) => (
                <li className="relative grid grid-cols-[0.6rem_minmax(0,1fr)] gap-4" key={entry.id}>
                  <span aria-hidden="true" className="relative z-10 mt-1.5 size-2.5 rounded-full border-2 border-[#e8e1d5] bg-[var(--color-poster)]" />
                  <article>
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-[var(--font-body)] text-xs">
                      <time className="text-black/58" dateTime={entry.date}>{formatDate(entry.date)}</time>
                      <span className="font-medium text-black/68">{entry.verb}</span>
                    </div>
                    <h3 className="mt-1.5 font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em] text-black/86">{entry.title}</h3>
                    <p className="mt-1.5 font-[var(--font-body)] text-sm leading-relaxed text-black/62">{entry.detail}</p>
                  </article>
                </li>
              ))}
            </ol>
          ) : <p className="mt-7 font-[var(--font-body)] text-sm text-black/62">No history recorded yet.</p>}
        </section>

        <div className="space-y-12 sm:space-y-14">
          <section aria-labelledby="artifacts-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-[var(--font-display)] text-4xl tracking-[-0.035em] text-black/88" id="artifacts-title">Artifacts.</h2>
              <Link className={quietLink} href="/my/artifacts">View all →</Link>
            </div>
            {member.artifacts.length > 0 ? (
              <ul className="mt-6 grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4">
                {member.artifacts.slice(0, 3).map((artifact, index) => (
                  <li key={artifact.awardId}>
                    <article>
                      <div className="relative aspect-square overflow-hidden border border-black/18 bg-black/[0.04] p-1.5">
                        <div className="relative size-full overflow-hidden bg-[#d8d0c2]">
                          {artifact.imageUrl ? <Image alt="" className="object-cover saturate-[0.85]" fill sizes="(min-width: 1280px) 15vw, 30vw" src={artifact.imageUrl} unoptimized /> : (
                            <div className="absolute inset-0 grid place-items-center">
                              <div aria-hidden="true" className="absolute inset-[8%] border border-black/12" />
                              <Image alt="" aria-hidden="true" className="h-auto w-[23%] opacity-70" height={72} src="/favicon-ruined-mark-v2.svg" width={72} />
                              <span aria-hidden="true" className="absolute left-[8%] top-[8%] font-[var(--font-body)] text-xs text-black/58">{String(index + 1).padStart(2, "0")}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <h3 className="mt-3 font-[var(--font-display)] text-xl leading-none tracking-[-0.025em] text-black/86 sm:text-2xl">{artifact.name}</h3>
                      <p className="mt-2 font-[var(--font-body)] text-xs text-black/58">Earned <time dateTime={artifact.earnedAt}>{formatDate(artifact.earnedAt)}</time></p>
                      <div className="mt-3"><ProfileState state={artifact.artifactState} /></div>
                    </article>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-6 font-[var(--font-body)] text-sm text-black/62">No artifacts yet.</p>}
          </section>

          <section aria-labelledby="experiences-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-[var(--font-display)] text-4xl tracking-[-0.035em] text-black/88" id="experiences-title">Upcoming experiences.</h2>
              <Link className={quietLink} href="/my/experiences">View all →</Link>
            </div>
            {member.upcomingExperiences.length > 0 ? (
              <ol className="mt-6 divide-y divide-black/16 border-t border-black/16">
                {member.upcomingExperiences.slice(0, 3).map((experience) => {
                  const stamp = formatEventStamp(experience.startsAt, member.profile.timezone);
                  return (
                    <li className="py-5" key={experience.id}>
                      <article className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-4 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-6">
                        <time aria-label={formatEventDate(experience.startsAt, member.profile.timezone)} className="border-r border-black/16 pr-3 text-center font-[var(--font-body)]" dateTime={experience.startsAt}>
                          <span aria-hidden="true" className="block text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-black/58">{stamp.month}</span>
                          <span aria-hidden="true" className="mt-1 block font-[var(--font-display)] text-3xl leading-none text-black/84">{stamp.day}</span>
                        </time>
                        <div>
                          <h3 className="font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em] text-black/86">{experience.title}</h3>
                          <p className="mt-2 font-[var(--font-body)] text-xs leading-relaxed text-black/62">{formatEventDate(experience.startsAt, member.profile.timezone)}{experience.locationLabel ? ` · ${experience.locationLabel}` : ""}</p>
                          <p className="mt-2 font-[var(--font-body)] text-sm text-black/62">{experience.audienceLabel} · {registrationLabel(experience.registrationState)}</p>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="mt-6 font-[var(--font-body)] text-sm text-black/62">Nothing scheduled.</p>}
          </section>
        </div>
      </div>

      <section aria-labelledby="member-information-title" className="mt-12 border-t border-black/18 pt-8 sm:mt-14">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className={eyebrow}>Private to you</p>
            <h2 className="mt-2 font-[var(--font-display)] text-3xl tracking-[-0.03em] text-black/88 sm:text-4xl" id="member-information-title">Profile details.</h2>
          </div>
          <Link className={quietLink} href="/my/profile">Edit information →</Link>
        </div>
        <dl className="mt-7 grid gap-x-7 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          <MembershipFact className="sm:col-span-2 xl:col-span-1" label="Email" value={member.identity.email} />
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
