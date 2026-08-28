import Image from "next/image";
import Link from "next/link";

import type { MemberHomeSnapshot } from "@/lib/membership/model";

const progressionLevels = ["Member", "Shaper", "Builder", "Author", "Partner"] as const;

const microLabel =
  "inline-block w-fit origin-left [font-family:var(--font-cadehandy2)] text-[1.28rem] leading-none tracking-normal text-[var(--color-poster)] [transform:rotate(-1deg)]";
const darkMicroLabel =
  "inline-block w-fit origin-left [font-family:var(--font-cadehandy2)] text-[1.28rem] leading-none tracking-normal text-[var(--color-highlight)] [transform:rotate(-1deg)]";
const sectionTitle =
  "ui-heading text-[clamp(1.5rem,3vw,2.45rem)] font-black uppercase leading-[0.88] tracking-[-0.045em] text-[#191613]";
const handLabel =
  "[font-family:var(--font-cadehandy2)] text-[1.55rem] leading-none tracking-normal text-[var(--color-poster)] sm:text-[1.75rem]";
const quietLink =
  "inline-flex min-h-11 items-center font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.055em] text-black/64 transition-colors hover:text-[var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]";

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
      aria-label={member.avatarUrl ? "Member portrait" : "Portrait not added"}
      className="relative aspect-[1750/2120] w-full drop-shadow-[0_12px_18px_rgba(40,30,18,0.18)]"
      data-member-polaroid
    >
      <div
        className="absolute left-[4.9%] top-[7.3%] h-[71.3%] w-[89.2%] overflow-hidden bg-[#171512]"
        data-placeholder={member.avatarUrl ? undefined : "portrait-pending"}
      >
        <Image
          alt=""
          aria-hidden="true"
          className={`object-cover ${member.avatarUrl ? "saturate-[0.82] contrast-[1.04]" : "saturate-[0.72] contrast-[1.08]"}`}
          fill
          priority
          sizes="(min-width: 1280px) 330px, (min-width: 1024px) 290px, (min-width: 640px) 230px, 140px"
          src={member.avatarUrl ?? "/membership/portrait-pending-editorial.webp"}
          unoptimized
        />
      </div>
      <Image
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full object-contain"
        fill
        priority
        sizes="(min-width: 1280px) 330px, (min-width: 1024px) 290px, (min-width: 640px) 230px, 140px"
        src="/membership/polaroid-frame.png"
        unoptimized
      />
      <figcaption className="absolute bottom-[5.1%] left-[8%] right-[8%] flex flex-col items-start justify-end gap-0.5 text-black/72 sm:flex-row sm:items-end sm:justify-between sm:gap-2">
        <span className="[font-family:var(--font-cadehandy2)] text-[0.86rem] leading-none sm:text-[1rem]">
          {member.avatarUrl ? "Member portrait" : "Photo pending"}
        </span>
        {member.memberSince ? (
          <span className="font-[var(--font-body)] text-[0.45rem] font-bold uppercase tracking-[0.04em] sm:text-[0.55rem]">
            Joined {formatMonthYear(member.memberSince)}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

function PersonAvatar({
  dark = false,
  person,
  size = "regular",
}: {
  dark?: boolean;
  person: MemberHomeSnapshot["circleMembers"][number];
  size?: "regular" | "small";
}) {
  const sizeClass = size === "small" ? "size-9" : "size-11";
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border ${sizeClass} ${
        dark ? "border-white/30 bg-white/10" : "border-black/25 bg-black/[0.06]"
      }`}
    >
      {person.avatarUrl ? (
        <Image alt="" className="object-cover" fill sizes={size === "small" ? "36px" : "44px"} src={person.avatarUrl} unoptimized />
      ) : (
        <span aria-hidden="true" className={`font-[var(--font-body)] text-[0.65rem] font-bold ${dark ? "text-white/82" : "text-black/72"}`}>
          {initials(person.displayName) || "R"}
        </span>
      )}
      <span className="sr-only">{person.displayName}</span>
    </span>
  );
}

function ProfileState({ state }: { state: string }) {
  const attention = state === "attention_required" || state === "ended" || state === "suspended";
  const complete = state === "active" || state === "completed" || state === "fulfilled";
  return (
    <span className="inline-flex items-center gap-2 font-[var(--font-body)] text-xs font-semibold uppercase tracking-[0.04em] text-black/64">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 ${attention ? "bg-[var(--color-poster)]" : complete ? "bg-[var(--color-verdigris)]" : "bg-black/45"}`}
      />
      {stateLabels[state] ?? state.replaceAll("_", " ")}
    </span>
  );
}

function RecordFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="[font-family:var(--font-cadehandy2)] text-[1.12rem] leading-none tracking-normal text-[var(--color-poster)]">{label}</dt>
      <dd className="mt-1 break-words font-[var(--font-body)] text-sm font-semibold leading-snug text-black/78">{value}</dd>
    </div>
  );
}

function ProgressionRail({ member }: { member: MemberHomeSnapshot }) {
  return (
    <div className="mt-5 max-w-2xl" data-member-progression>
      <div className="flex items-baseline justify-between gap-3">
        <p className={microLabel}>Current level</p>
        <p className="ui-heading text-sm font-black uppercase tracking-[-0.02em] text-black/76">{member.progression.name}</p>
      </div>
      <ol aria-label="Membership progression" className="mt-2 grid grid-cols-5 gap-1.5">
        {progressionLevels.map((level, index) => {
          const reached = index + 1 < member.progression.position;
          const current = index + 1 === member.progression.position;
          const state = current ? "Current" : reached ? "Reached" : "Upcoming";
          return (
            <li aria-current={current ? "step" : undefined} className="min-w-0 font-[var(--font-body)]" key={level}>
              <span aria-hidden="true" className={`block h-1.5 ${current ? "bg-[var(--color-poster)]" : reached ? "bg-[var(--color-verdigris)]" : "bg-black/15"}`} />
              <span className={`mt-1.5 block truncate text-[0.58rem] font-bold uppercase tracking-[-0.01em] ${current ? "text-black" : "text-black/48"}`}>{level}</span>
              <span className="sr-only">{state}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function historyFor(member: MemberHomeSnapshot) {
  const entries: Array<{ date: string; detail: string | null; id: string; title: string; verb: string }> = [];

  for (const artifact of member.artifacts) {
    entries.push({
      date: artifact.earnedAt,
      detail: artifact.earnedReason || null,
      id: `artifact-${artifact.awardId}`,
      title: artifact.name,
      verb: "Earned",
    });
  }

  if (member.foundations.requirements.futureLetter.completedAt) {
    entries.push({
      date: member.foundations.requirements.futureLetter.completedAt,
      detail: null,
      id: "future-letter",
      title: "Future Letter",
      verb: "Completed",
    });
  }

  if (member.foundations.requirements.timeline.completedAt) {
    const count = member.foundations.requirements.timeline.entryCount;
    entries.push({
      date: member.foundations.requirements.timeline.completedAt,
      detail: `${count} timeline ${count === 1 ? "entry" : "entries"}`,
      id: "ruined-timeline",
      title: "Ruined Timeline",
      verb: "Completed",
    });
  }

  if (member.memberSince) {
    entries.push({
      date: member.memberSince,
      detail: null,
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
    case "available": return "Registration open";
    case "registered": return "Registered";
    case "waitlisted": return "Waitlisted";
    case "external": return "External registration";
    case "cancelled": return "Cancelled";
    case "closed": return "Registration closed";
    default: return "No registration required";
  }
}

export default function MemberHome({ member }: { member: MemberHomeSnapshot }) {
  const preferredName = member.profile.preferredName || (member.displayName === "Member" ? null : member.displayName);
  const greeting = preferredName ? `Welcome, ${preferredName}.` : "Welcome.";
  const profileName = member.profile.fullName?.trim()
    || (member.profile.displayName === "Member" ? "Name not added" : member.profile.displayName);
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
    <main className="member-profile-dossier mx-auto max-w-[82rem] pb-20 pt-1 sm:pb-24 sm:pt-2" data-member-profile-dossier>
      <header>
        <h1 className="ui-heading inline-block max-w-full break-words bg-[var(--color-highlight)] px-[0.26em] py-[0.14em] text-[clamp(1.05rem,2.35vw,2rem)] font-black uppercase leading-[0.92] tracking-[-0.045em] text-[#080605]">
          {greeting}
        </h1>

        <div className="mt-4 grid grid-cols-[7.75rem_minmax(0,1fr)] gap-x-4 gap-y-4 min-[380px]:grid-cols-[8.5rem_minmax(0,1fr)] sm:mt-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-x-6 lg:grid-cols-[minmax(18rem,0.96fr)_minmax(20rem,1.34fr)_minmax(14rem,0.72fr)] lg:items-start lg:gap-x-8 xl:grid-cols-[minmax(19rem,0.96fr)_minmax(26rem,1.34fr)_minmax(16rem,0.72fr)] xl:gap-x-10">
          <div className="min-w-0 sm:row-span-2"><MemberPortrait member={member} /></div>

          <div className="min-w-0 self-center lg:self-start lg:pt-2">
            <p className={microLabel}>Member</p>
            <h2 className="ui-heading mt-1.5 max-w-[12ch] break-words text-balance text-[clamp(1.9rem,5.2vw,4.75rem)] font-black uppercase leading-[0.82] tracking-[-0.055em] text-[#15120f] sm:mt-2">
              {profileName}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-[var(--font-body)] text-[0.68rem] font-semibold uppercase tracking-[0.035em] text-black/52 sm:text-xs">
              <ProfileState state={member.identity.standingState} />
              {member.profile.location ? <span>{member.profile.location}</span> : null}
              {member.memberSince ? <span>Joined {formatMonthYear(member.memberSince)}</span> : null}
            </div>
          </div>

          <aside aria-labelledby="member-next-action" className="order-4 col-span-2 rounded-[4px] bg-[#171411] p-4 text-[#eee8dd] sm:p-5 lg:order-none lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-start">
            <p className={darkMicroLabel}>Next</p>
            <h2 className="mt-3 font-[var(--font-display)] text-[1.75rem] leading-[0.94] tracking-[-0.035em] text-[#f1ece3] sm:text-3xl" id="member-next-action">
              {member.nextAction.title}
            </h2>
            <Link
              className="mt-5 inline-flex min-h-11 w-full items-center justify-between rounded-[4px] bg-[#eee8dd] px-3.5 py-2 font-[var(--font-body)] text-[0.66rem] font-black uppercase tracking-[0.045em] text-[#11100e] transition-colors hover:bg-[var(--color-highlight)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-highlight)]"
              href={member.nextAction.href}
            >
              {nextActionLabel(member.nextAction.kind)} <span aria-hidden="true">→</span>
            </Link>
          </aside>

          <div className="order-3 col-span-2 min-w-0 sm:col-start-2 sm:col-span-1 lg:order-none lg:col-start-2">
            {member.profile.buildingNow || member.profile.bio ? (
              <div className="max-w-2xl">
                <p className={handLabel}>what I’m building</p>
                {member.profile.buildingNow ? <p className="mt-2 font-[var(--font-display)] text-xl leading-[1.08] tracking-[-0.02em] text-black/82 sm:text-2xl">{member.profile.buildingNow}</p> : null}
                {member.profile.bio ? <p className="mt-2 max-w-xl font-[var(--font-body)] text-sm leading-relaxed text-black/58">{member.profile.bio}</p> : null}
              </div>
            ) : (
              <p className="font-[var(--font-body)] text-sm font-medium text-black/52">Add what you’re building to make this record yours.</p>
            )}
            <div className="mt-2 flex flex-wrap items-end justify-between gap-x-5 gap-y-1">
              <Link className={quietLink} href="/my/profile">Edit profile →</Link>
            </div>
            <ProgressionRail member={member} />
          </div>
        </div>
      </header>

      {member.access.reason ? (
        <aside aria-label="Membership access" className="mt-4 rounded-[4px] bg-[var(--color-poster)]/[0.08] px-4 py-3 font-[var(--font-body)] text-sm leading-relaxed text-black/68">
          {member.access.reason}
        </aside>
      ) : null}

      <section aria-label="Membership snapshot" className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <article aria-labelledby="foundations-summary-title" className="rounded-[4px] bg-black/[0.045] p-4 sm:p-5 lg:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={microLabel}>Foundations</p>
              <h2 className="ui-heading mt-2 text-[clamp(2.8rem,6vw,5.3rem)] font-black uppercase leading-[0.8] tracking-[-0.06em] text-black/88" id="foundations-summary-title">
                {foundationPercent}%
              </h2>
              <p className="mt-2 font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.035em] text-black/55">{foundationHeading}</p>
            </div>
            <Link className={quietLink} href="/my/foundations">View →</Link>
          </div>
          {circleGateOutstanding ? <p className="mt-3 font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.035em] text-[var(--color-poster)]">Active Circle required to complete.</p> : null}
          <div aria-label={foundationValueText} aria-valuemax={100} aria-valuemin={0} aria-valuenow={foundationPercent} aria-valuetext={foundationValueText} className="mt-4 h-2 overflow-hidden rounded-[2px] bg-black/14" role="progressbar">
            <span className={`block h-full rounded-[2px] ${foundationComplete ? "bg-[var(--color-verdigris)]" : "bg-[var(--color-poster)]"}`} style={{ width: `${foundationPercent}%` }} />
          </div>
          <ol className="mt-4 grid grid-cols-4 gap-2">
            {requirementSteps.map((step, index) => {
              const current = firstIncompleteRequirement === index;
              const stepState = step.complete ? "Complete" : current ? "Current" : "Waiting";
              return (
                <li aria-current={current ? "step" : undefined} className="min-w-0" key={step.label}>
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={`size-1.5 shrink-0 ${step.complete ? "bg-[var(--color-verdigris)]" : current ? "bg-[var(--color-poster)]" : "bg-black/24"}`} />
                    <span className="font-[var(--font-body)] text-[0.58rem] font-bold text-black/42">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <p className="mt-1.5 break-words font-[var(--font-body)] text-[0.63rem] font-bold uppercase leading-tight tracking-[-0.01em] text-black/68 sm:text-[0.69rem]">{step.label}</p>
                  <span className="sr-only">{stepState}</span>
                </li>
              );
            })}
          </ol>
        </article>

        <article aria-labelledby="circle-summary-title" className="flex min-h-full flex-col rounded-[4px] bg-[#171411] p-4 text-[#eee8dd] sm:p-5 lg:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={darkMicroLabel}>Circle</p>
              <h2 className="ui-heading mt-2 text-[clamp(1.75rem,4vw,3.25rem)] font-black uppercase leading-[0.84] tracking-[-0.05em] text-[#f0ebe2]" id="circle-summary-title">
                {member.circleName ?? "Circle forming"}
              </h2>
            </div>
            <Link className="inline-flex min-h-11 items-center font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.035em] text-white/62 underline decoration-white/25 underline-offset-[0.34rem] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-highlight)]" href="/my/circle">Open →</Link>
          </div>
          {member.circleMembers.length > 0 ? (
            <ul aria-label="Circle members" className="mt-4 flex -space-x-2 overflow-hidden py-1">{member.circleMembers.slice(0, 7).map((person) => <li key={person.id}><PersonAvatar dark person={person} /></li>)}</ul>
          ) : null}
          <div className="mt-auto pt-5">
            <p className={darkMicroLabel}>Accountability partner</p>
            <div className="mt-2 flex items-center gap-3">
              {member.partner ? <PersonAvatar dark person={member.partner} size="small" /> : null}
              <p className="ui-heading text-lg font-black uppercase leading-none tracking-[-0.025em] text-white/82">{member.partner?.displayName ?? "Unpaired"}</p>
            </div>
          </div>
        </article>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)] lg:gap-9">
        <section aria-labelledby="history-title">
          <h2 className={sectionTitle} id="history-title">History</h2>
          {history.length > 0 ? (
            <ol className="mt-5 space-y-5">
              {history.map((entry) => (
                <li className="grid grid-cols-[4.7rem_minmax(0,1fr)] gap-3" key={entry.id}>
                  <div className="font-[var(--font-body)] text-[0.61rem] font-semibold uppercase leading-snug tracking-[0.035em] text-black/48">
                    <time className="block" dateTime={entry.date}>{formatDate(entry.date)}</time>
                    <span className="mt-1 block text-[var(--color-poster)]">{entry.verb}</span>
                  </div>
                  <article>
                    <h3 className="ui-heading text-lg font-black uppercase leading-[0.95] tracking-[-0.025em] text-black/82 sm:text-xl">{entry.title}</h3>
                    {entry.detail ? <p className="mt-1 font-[var(--font-body)] text-xs leading-relaxed text-black/52">{entry.detail}</p> : null}
                  </article>
                </li>
              ))}
            </ol>
          ) : <p className="mt-4 font-[var(--font-body)] text-sm text-black/54">Nothing recorded yet.</p>}
        </section>

        <div className="space-y-8">
          <section aria-labelledby="artifacts-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className={sectionTitle} id="artifacts-title">Artifacts</h2>
              <Link className={quietLink} href="/my/artifacts">View all →</Link>
            </div>
            {member.artifacts.length > 0 ? (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {member.artifacts.slice(0, 3).map((artifact) => (
                  <li key={artifact.awardId}>
                    <article>
                      <div className="relative aspect-[4/3] overflow-hidden rounded-[4px] bg-[#171411]" data-placeholder={artifact.imageUrl ? undefined : "artifact-image-not-recorded"}>
                        <Image
                          alt=""
                          aria-hidden="true"
                          className={`object-cover ${artifact.imageUrl ? "saturate-[0.82]" : "saturate-[0.7] contrast-[1.05]"}`}
                          fill
                          sizes="(min-width: 1280px) 18vw, (min-width: 640px) 30vw, 45vw"
                          src={artifact.imageUrl ?? "/membership/archive-material-placeholder.webp"}
                          unoptimized
                        />
                        {!artifact.imageUrl ? <span className="absolute bottom-2 left-2 rounded-[2px] bg-[#171411] px-2 py-1 [font-family:var(--font-cadehandy2)] text-[0.9rem] leading-none text-[var(--color-highlight)]">Image not recorded</span> : null}
                      </div>
                      <h3 className="ui-heading mt-2.5 text-lg font-black uppercase leading-[0.92] tracking-[-0.025em] text-black/82 sm:text-xl">{artifact.name}</h3>
                      <p className="mt-1.5 font-[var(--font-body)] text-[0.62rem] font-semibold uppercase tracking-[0.025em] text-black/48">Earned <time dateTime={artifact.earnedAt}>{formatDate(artifact.earnedAt)}</time></p>
                      <div className="mt-2"><ProfileState state={artifact.artifactState} /></div>
                    </article>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 grid overflow-hidden rounded-[4px] bg-black/[0.045] sm:grid-cols-[minmax(12rem,0.85fr)_minmax(0,1.15fr)]" data-placeholder="empty-artifact-archive">
                <div className="relative aspect-[3/2] min-h-[9rem] sm:aspect-auto">
                  <Image alt="" aria-hidden="true" className="object-cover saturate-[0.7] contrast-[1.05]" fill sizes="(min-width: 1024px) 28vw, 100vw" src="/membership/archive-material-placeholder.webp" unoptimized />
                </div>
                <div className="self-center p-4 sm:p-5">
                  <p className={microLabel}>Archive empty</p>
                  <p className="ui-heading mt-2 text-xl font-black uppercase leading-[0.9] tracking-[-0.035em] text-black/74">Nothing earned yet</p>
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="experiences-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className={sectionTitle} id="experiences-title">Upcoming</h2>
              <Link className={quietLink} href="/my/experiences">View all →</Link>
            </div>
            {member.upcomingExperiences.length > 0 ? (
              <ol className="mt-4 grid gap-2">
                {member.upcomingExperiences.slice(0, 3).map((experience) => {
                  const stamp = formatEventStamp(experience.startsAt, member.profile.timezone);
                  return (
                    <li key={experience.id}>
                      <Link
                        className="group block rounded-[4px] bg-black/[0.035] p-3 transition-colors hover:bg-black/[0.065] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)] sm:p-4"
                        href={experience.detailHref}
                      >
                        <article className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] gap-3 sm:grid-cols-[3.75rem_minmax(0,1fr)_auto] sm:gap-4">
                          <time aria-label={formatEventDate(experience.startsAt, member.profile.timezone)} className="font-[var(--font-body)]" dateTime={experience.startsAt}>
                            <span aria-hidden="true" className="block text-[0.59rem] font-bold uppercase tracking-[0.06em] text-black/48">{stamp.month}</span>
                            <span aria-hidden="true" className="ui-heading mt-0.5 block text-3xl font-black leading-none tracking-[-0.04em] text-black/78">{stamp.day}</span>
                          </time>
                          <div>
                            <h3 className="ui-heading text-lg font-black uppercase leading-[0.92] tracking-[-0.025em] text-black/82 transition-colors group-hover:text-[var(--color-poster)] sm:text-xl">{experience.title}</h3>
                            <p className="mt-1.5 font-[var(--font-body)] text-[0.68rem] leading-relaxed text-black/52">{formatEventDate(experience.startsAt, member.profile.timezone)}{experience.locationLabel ? ` · ${experience.locationLabel}` : ""}</p>
                            <p className="mt-1 font-[var(--font-body)] text-[0.67rem] font-semibold text-black/52">{experience.audienceLabel} · {registrationLabel(experience.registrationState)}</p>
                          </div>
                          <span aria-hidden="true" className="font-[var(--font-body)] text-sm font-bold text-black/44 transition-transform group-hover:translate-x-0.5">→</span>
                        </article>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="mt-4 font-[var(--font-body)] text-sm text-black/54">No dates yet.</p>}
          </section>
        </div>
      </div>

      <section aria-labelledby="member-information-title" className="mt-8 rounded-[4px] bg-black/[0.045] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="ui-heading text-lg font-black uppercase tracking-[-0.025em] text-black/76" id="member-information-title">Member info</h2>
          <span className={microLabel}>Private to you</span>
        </div>
        <dl className="mt-4 grid gap-x-7 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <RecordFact label="Email" value={member.identity.email} />
          <RecordFact label="Timezone" value={member.profile.timezone ?? "Not added"} />
          <RecordFact label="Circle profile" value={member.profile.directoryStatus === "circle_visible" ? "Visible" : "Private"} />
          <RecordFact label="Block" value={member.blockName ?? "Not formed"} />
        </dl>
      </section>
    </main>
  );
}
