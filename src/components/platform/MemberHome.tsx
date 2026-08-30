import Image from "next/image";
import Link from "next/link";

import CircleMemberPortrait from "@/components/membership/CircleMemberPortrait";
import type { MemberHomeSnapshot } from "@/lib/membership/model";

const contributionWays = ["Shape", "Build", "Author", "Partner"] as const;

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

const artifactAcquisitionLabels = {
  earned: "Earned",
  gifted: "Gifted",
  purchased: "Purchased",
} as const;

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
          sizes="(min-width: 1280px) 480px, (min-width: 1024px) 42vw, (min-width: 640px) 44vw, 52vw"
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
        sizes="(min-width: 1280px) 480px, (min-width: 1024px) 42vw, (min-width: 640px) 44vw, 52vw"
        src="/membership/polaroid-frame.png"
        unoptimized
      />
      <figcaption className="absolute bottom-[5.1%] left-[8%] right-[8%] text-black/72">
        <span className="[font-family:var(--font-cadehandy2)] text-[0.86rem] leading-none sm:text-[1rem]">
          {member.avatarUrl ? "Member portrait" : "Photo pending"}
        </span>
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
      <CircleMemberPortrait
        imageClassName="object-cover saturate-[0.82] contrast-[1.04]"
        imageSizes={size === "small" ? "36px" : "44px"}
        initialsClassName={`absolute inset-0 grid place-items-center font-[var(--font-body)] text-[0.65rem] font-bold ${dark ? "bg-white/10 text-white/82" : "bg-black/[0.06] text-black/72"}`}
        person={person}
        previewClassName="absolute inset-0 bg-[var(--color-workwear)] bg-no-repeat saturate-[0.8] contrast-[1.035]"
      />
      <span className="sr-only">{person.displayName}</span>
    </span>
  );
}

function ProfileState({ compact = false, state }: { compact?: boolean; state: string }) {
  const attention = state === "attention_required" || state === "ended" || state === "suspended";
  const complete = state === "active" || state === "completed" || state === "fulfilled";
  return (
    <span className={`inline-flex items-center gap-2 font-[var(--font-body)] font-semibold uppercase tracking-[0.04em] text-black/64 ${compact ? "text-[0.62rem] sm:text-xs" : "text-xs"}`}>
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

function WantMore() {
  return (
    <aside className="w-full max-w-2xl rounded-[4px] bg-black/[0.045] px-3.5 py-3 sm:px-4 sm:py-3.5" data-member-more>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1">
        <p className={microLabel}>Want more?</p>
        <a
          className={quietLink}
          href="mailto:connect@theruinedproject.com?subject=I%20want%20to%20take%20part"
        >
          Raise your hand →
        </a>
      </div>
      <ul aria-label="Ways to take part" className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {contributionWays.map((way) => (
          <li className="ui-heading text-sm font-black uppercase tracking-[-0.015em] text-black/58" key={way}>{way}</li>
        ))}
      </ul>
    </aside>
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
      verb: artifactAcquisitionLabels[artifact.acquisitionType],
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

function NextActionsBento({
  circleGateOutstanding,
  foundationComplete,
  foundationHeading,
  foundationPercent,
  foundationValueText,
  member,
}: {
  circleGateOutstanding: boolean;
  foundationComplete: boolean;
  foundationHeading: string;
  foundationPercent: number;
  foundationValueText: string;
  member: MemberHomeSnapshot;
}) {
  const upcoming = member.upcomingExperiences[0] ?? null;
  const upcomingStamp = upcoming ? formatEventStamp(upcoming.startsAt, upcoming.timezone) : null;
  const foundationsIsNext = member.nextAction.kind === "foundations";

  return (
    <section aria-labelledby="member-next-actions" className="mt-10 sm:mt-12" data-member-next-actions>
      <h2 className={handLabel} id="member-next-actions">Next actions</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 pb-2 pr-2 sm:gap-4 lg:auto-rows-[minmax(7.75rem,auto)] lg:grid-cols-12">
        <Link
          className={`group col-span-2 flex min-h-[9.25rem] flex-col justify-between rounded-[4px] p-3.5 shadow-[7px_8px_0_var(--color-poster)] transition-[background-color,box-shadow,transform] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_5px_0_var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none sm:min-h-[10.5rem] sm:p-5 lg:col-span-5 lg:row-span-2 lg:min-h-full ${foundationsIsNext ? "bg-[var(--color-verdigris)] text-[var(--color-bone)] hover:bg-[#466b5c] focus-visible:outline-[var(--color-highlight)]" : "bg-[var(--color-faded)] text-[var(--color-bone)] hover:bg-[#353535] focus-visible:outline-[var(--color-highlight)]"}`}
          data-primary-action-tone={foundationsIsNext ? "verdigris" : "faded"}
          href={member.nextAction.href}
        >
          <div>
            <p className={darkMicroLabel}>Start here</p>
            <h3 className="ui-heading mt-2.5 max-w-[15ch] text-[clamp(1.6rem,4.1vw,3.35rem)] font-black uppercase leading-[0.84] tracking-[-0.055em] text-[var(--color-bone)]">
              {member.nextAction.title}
            </h3>
          </div>
          <span className="mt-6 flex items-center justify-between font-[var(--font-body)] text-[0.68rem] font-black uppercase tracking-[0.045em] text-white/68 transition-colors group-hover:text-[var(--color-highlight)]">
            {nextActionLabel(member.nextAction.kind)} <span aria-hidden="true">→</span>
          </span>
        </Link>

        <Link
          className="group col-span-1 flex min-h-[8.25rem] flex-col rounded-[4px] bg-[var(--color-faded)] p-3.5 text-[var(--color-bone)] shadow-[7px_8px_0_rgba(0,0,0,0.5)] transition-[background-color,box-shadow,transform] hover:bg-[#353535] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_5px_0_rgba(0,0,0,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-highlight)] motion-reduce:transition-none sm:min-h-[9.5rem] sm:p-4 lg:col-span-3"
          data-foundations-action
          href="/my/foundations"
        >
          <p className={darkMicroLabel}>Foundations</p>
          <p className="ui-heading mt-2 text-[2.45rem] font-black leading-[0.82] tracking-[-0.055em] text-[var(--color-bone)] sm:text-5xl">{foundationPercent}%</p>
          <p className={`mt-2 font-[var(--font-body)] text-[0.61rem] font-bold uppercase leading-tight tracking-[0.025em] ${circleGateOutstanding ? "text-[var(--color-highlight)]" : "text-white/52"}`}>
            {circleGateOutstanding ? "Active Circle required" : foundationHeading}
          </p>
          <div aria-label={foundationValueText} aria-valuemax={100} aria-valuemin={0} aria-valuenow={foundationPercent} aria-valuetext={foundationValueText} className="mt-auto h-1.5 overflow-hidden rounded-[2px] bg-white/16" role="progressbar">
            <span className={`block h-full rounded-[2px] ${foundationComplete ? "bg-[var(--color-verdigris)]" : "bg-[var(--color-poster)]"}`} style={{ width: `${foundationPercent}%` }} />
          </div>
        </Link>

        <Link
          className="group col-span-1 flex min-h-[8.25rem] flex-col rounded-[4px] bg-[var(--color-highlight)] p-3.5 text-[#11100e] shadow-[7px_8px_0_rgba(0,0,0,0.5)] transition-[background-color,box-shadow,transform] hover:bg-[#f3bd18] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_5px_0_rgba(0,0,0,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black motion-reduce:transition-none sm:min-h-[9.5rem] sm:p-4 lg:col-span-4"
          href={upcoming?.detailHref ?? "/my/experiences"}
        >
          <p className="[font-family:var(--font-cadehandy2)] text-[1.28rem] leading-none tracking-normal text-black/72">Upcoming</p>
          {upcoming && upcomingStamp ? (
            <div className="mt-3">
              <p className="font-[var(--font-body)] text-[0.62rem] font-black uppercase tracking-[0.045em] text-black/52">{upcomingStamp.month} {upcomingStamp.day}</p>
              <h3 className="ui-heading mt-1.5 text-base font-black uppercase leading-[0.9] tracking-[-0.035em] text-black/84 sm:text-xl">{upcoming.title}</h3>
            </div>
          ) : (
            <p className="ui-heading mt-3 text-lg font-black uppercase leading-[0.9] tracking-[-0.035em] text-black/72">No dates yet</p>
          )}
          <span className="mt-auto pt-3 font-[var(--font-body)] text-[0.62rem] font-black uppercase tracking-[0.04em] text-black/58">View →</span>
        </Link>

        <Link
          className="group col-span-2 grid min-h-[8.5rem] grid-cols-[minmax(0,1fr)_auto] items-end gap-3 rounded-[4px] bg-[var(--color-shop)] p-3.5 text-[var(--color-faded)] shadow-[7px_8px_0_rgba(0,0,0,0.5)] transition-[background-color,box-shadow,transform] hover:bg-[#a9c2d7] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_5px_0_rgba(0,0,0,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)] motion-reduce:transition-none sm:min-h-[9rem] sm:gap-4 sm:p-5 lg:col-span-7"
          data-circle-action
          href="/my/circle"
        >
          <div className="min-w-0">
            <p className={microLabel}>Circle</p>
            <h3 className="ui-heading mt-2 break-words text-[clamp(1.7rem,3.8vw,3rem)] font-black uppercase leading-[0.84] tracking-[-0.05em] text-[var(--color-faded)]">{member.circleName ?? "Circle forming"}</h3>
            {member.circleMembers.length > 0 ? (
              <ul aria-label="Circle members" className="mt-3 flex -space-x-2 overflow-hidden py-1">
                {member.circleMembers.slice(0, 6).map((person) => <li key={person.id}><PersonAvatar person={person} size="small" /></li>)}
              </ul>
            ) : null}
          </div>
          <div className="sm:text-right">
            <p className="[font-family:var(--font-cadehandy2)] text-[1.12rem] leading-none text-[var(--color-poster)]">People</p>
            <p className="ui-heading mt-1.5 text-base font-black uppercase leading-none tracking-[-0.025em] text-black/68">{member.circleMembers.length} members</p>
            {member.blockName ? <p className="mt-2 font-[var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.035em] text-black/46">{member.blockName}</p> : null}
            <span className="mt-3 inline-block font-[var(--font-body)] text-[0.62rem] font-black uppercase tracking-[0.04em] text-black/52">Open →</span>
          </div>
        </Link>
      </div>
    </section>
  );
}

export default function MemberHome({ member }: { member: MemberHomeSnapshot }) {
  const preferredName = member.profile.preferredName || (member.displayName === "Member" ? null : member.displayName);
  const greeting = preferredName ? `Welcome, ${preferredName}.` : "Welcome.";
  const profileName = member.profile.fullName?.trim()
    || (member.profile.displayName === "Member" ? "Name not added" : member.profile.displayName);
  const profileBio = member.profile.bio?.trim() || member.profile.buildingNow?.trim() || null;
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

  return (
    <main className="member-profile-dossier mx-auto max-w-[82rem] pb-20 pt-1 sm:pb-24 sm:pt-2" data-member-profile-dossier>
      <header>
        <h1 className="ui-heading mt-4 inline-block max-w-full break-words bg-[var(--color-highlight)] px-[0.28em] py-[0.16em] text-[clamp(0.82rem,1.45vw,1.18rem)] font-black uppercase leading-none tracking-[-0.035em] text-[#080605] sm:mt-6">
          {greeting}
        </h1>

        <div className="relative mt-3 grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-start gap-x-4 gap-y-5 sm:mt-4 sm:grid-cols-[minmax(17rem,0.88fr)_minmax(0,1.12fr)] sm:gap-x-8 lg:grid-cols-[minmax(22rem,0.88fr)_minmax(0,1.12fr)] lg:gap-x-10 xl:grid-cols-[minmax(25rem,0.88fr)_minmax(0,1.12fr)] xl:gap-x-12" data-member-profile-hero>
          <Link
            aria-label="Edit profile"
            className="absolute right-0 top-0 z-10 grid size-11 place-items-center rounded-full bg-[var(--color-bone)]/65 text-black/52 transition-colors hover:bg-[var(--color-bone)] hover:text-black/82 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]"
            data-member-profile-edit
            href="/my/profile"
          >
            <svg aria-hidden="true" className="size-[1.05rem]" fill="none" viewBox="0 0 24 24">
              <path d="m13.5 6.5 4 4M4.5 19.5l3.8-.8L19 8a2.83 2.83 0 0 0-4-4L4.3 14.7l-.8 3.8 1 1Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
            </svg>
          </Link>

          <div className="min-w-0 self-start lg:max-w-[30rem]" data-member-profile-portrait>
            <MemberPortrait member={member} />
          </div>

          <div className="min-w-0 self-start pt-11 sm:pr-12 sm:pt-2" data-member-profile-identity>
            <p className={microLabel}>Member</p>
            <h2 className="ui-heading mt-1.5 max-w-[12ch] break-words text-balance text-[clamp(1.6rem,6.5vw,2.05rem)] font-black uppercase leading-[0.82] tracking-[-0.055em] text-[#15120f] sm:mt-2 sm:text-[clamp(2.2rem,4.7vw,4.25rem)]">
              {profileName}
            </h2>
            <div className="mt-2.5 flex flex-col items-start gap-y-1.5 font-[var(--font-body)] text-[0.58rem] font-semibold uppercase tracking-[0.025em] text-black/62 sm:mt-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:text-xs sm:tracking-[0.035em]">
              <ProfileState state={member.identity.standingState} compact />
              {member.profile.location ? <span>{member.profile.location}</span> : null}
              {member.memberSince ? <span>Joined {formatMonthYear(member.memberSince)}</span> : null}
            </div>
            {profileBio ? (
              <p className="mt-3 line-clamp-5 max-w-[34rem] font-[var(--font-body)] text-[0.68rem] leading-[1.45] text-black/62 sm:mt-4 sm:line-clamp-4 sm:text-sm" data-member-profile-bio>
                {profileBio}
              </p>
            ) : null}
            {/* Keep the remaining identity-column space open for durable member badges. */}
          </div>
        </div>
      </header>

      {member.access.reason ? (
        <aside aria-label="Membership access" className="mt-4 rounded-[4px] bg-[var(--color-poster)]/[0.08] px-4 py-3 font-[var(--font-body)] text-sm leading-relaxed text-black/68">
          {member.access.reason}
        </aside>
      ) : null}

      <NextActionsBento
        circleGateOutstanding={circleGateOutstanding}
        foundationComplete={foundationComplete}
        foundationHeading={foundationHeading}
        foundationPercent={foundationPercent}
        foundationValueText={foundationValueText}
        member={member}
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)] lg:gap-9">
        <section aria-labelledby="history-title">
          <h2 className={sectionTitle} id="history-title">History</h2>
          {history.length > 0 ? (
            <ol className="mt-4 grid gap-2">
              {history.map((entry) => (
                <li className="grid grid-cols-[4.7rem_minmax(0,1fr)] gap-3 rounded-[4px] bg-black/[0.035] p-3 sm:p-4" data-member-history-entry key={entry.id}>
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
                      {artifact.description ? <p className="mt-1.5 font-[var(--font-body)] text-xs leading-snug text-black/58">{artifact.description}</p> : null}
                      <p className="mt-1.5 font-[var(--font-body)] text-[0.62rem] font-semibold uppercase tracking-[0.025em] text-black/48">{artifactAcquisitionLabels[artifact.acquisitionType]} <time dateTime={artifact.earnedAt}>{formatDate(artifact.earnedAt)}</time></p>
                      <div className="mt-2"><ProfileState state={artifact.artifactState} /></div>
                      {artifact.product?.href ? <Link className="mt-2 inline-flex font-[var(--font-body)] text-[0.62rem] font-black uppercase tracking-[0.04em] text-black/58 underline decoration-black/25 underline-offset-4 hover:text-black" href={artifact.product.href}>View product →</Link> : null}
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
                  const stamp = formatEventStamp(experience.startsAt, experience.timezone);
                  return (
                    <li key={experience.id}>
                      <Link
                        className="group block rounded-[4px] bg-black/[0.035] p-3 transition-colors hover:bg-black/[0.065] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)] sm:p-4"
                        href={experience.detailHref}
                      >
                        <article className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] gap-3 sm:grid-cols-[3.75rem_minmax(0,1fr)_auto] sm:gap-4">
                          <time aria-label={formatEventDate(experience.startsAt, experience.timezone)} className="font-[var(--font-body)]" dateTime={experience.startsAt}>
                            <span aria-hidden="true" className="block text-[0.59rem] font-bold uppercase tracking-[0.06em] text-black/48">{stamp.month}</span>
                            <span aria-hidden="true" className="ui-heading mt-0.5 block text-3xl font-black leading-none tracking-[-0.04em] text-black/78">{stamp.day}</span>
                          </time>
                          <div>
                            <h3 className="ui-heading text-lg font-black uppercase leading-[0.92] tracking-[-0.025em] text-black/82 transition-colors group-hover:text-[var(--color-poster)] sm:text-xl">{experience.title}</h3>
                            <p className="mt-1.5 font-[var(--font-body)] text-[0.68rem] leading-relaxed text-black/52">{formatEventDate(experience.startsAt, experience.timezone)}{experience.locationLabel ? ` · ${experience.locationLabel}` : ""}</p>
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

      <div className="mt-8 flex justify-end">
        <WantMore />
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
