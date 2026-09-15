import Link from "next/link";

import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import { OPERATOR_BUTTON_CLASS } from "@/components/platform/operatorStyles";
import type {
  OpsOverviewActivityItem,
  OpsOverviewData,
  OpsWorkItem,
} from "@/lib/platform/ops-model";

const DENVER_TIME_ZONE = "America/Denver";

function dateKey(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: DENVER_TIME_ZONE,
    year: "numeric",
  }).format(value);
}

function activityGroup(value: string, now: Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Earlier";
  if (dateKey(date) === dateKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey(date) === dateKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: DENVER_TIME_ZONE,
  }).format(date);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DENVER_TIME_ZONE,
  }).format(date);
}

function formatExperienceDate(value: string | null): string {
  if (!value) return "Schedule pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Schedule pending";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: DENVER_TIME_ZONE,
  }).format(date);
}

function activityTone(tone: OpsOverviewActivityItem["tone"]): string {
  if (tone === "attention") return "bg-[var(--color-poster)]";
  if (tone === "complete") return "bg-[var(--color-verdigris)]";
  return "bg-black/35";
}

function workHref(item: OpsWorkItem): string {
  if (item.kind === "workflow_failure") return "/ops/system";
  if (item.kind === "artifact") {
    return `/ops/artifacts?focus=${encodeURIComponent(item.workId)}#artifact-${item.workId}`;
  }
  return item.memberId ? `/ops/members/${item.memberId}#record` : "/ops/work";
}

export default function OpsOverview({ data }: { data: OpsOverviewData }) {
  const now = new Date();
  const groupedActivity = data.activity.reduce<Array<{
    items: OpsOverviewActivityItem[];
    label: string;
  }>>((groups, item) => {
    const label = activityGroup(item.occurredAt, now);
    const current = groups.at(-1);
    if (current?.label === label) current.items.push(item);
    else groups.push({ items: [item], label });
    return groups;
  }, []);
  const openWork = data.counts.work.artifacts
    + data.counts.work.failures
    + data.counts.work.tasks;
  const attention = data.attention.filter((item) => item.count > 0);
  const card = "min-w-0 rounded-[6px] p-5 shadow-[3px_3px_0_#2a2a2a14] sm:p-6";
  const textLink = "inline-flex min-h-11 items-center gap-2 text-sm font-medium underline decoration-current/25 underline-offset-4 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current";
  const cardLink = "mt-auto inline-flex min-h-11 items-center gap-2 pt-3 text-sm font-medium underline decoration-current/25 underline-offset-4 after:absolute after:inset-0 after:rounded-[6px] after:content-[''] hover:after:bg-black/[0.025] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-black";

  return (
    <OperatorPageFrame title="Overview">
      <header className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="font-[var(--font-display)] text-3xl sm:text-4xl">Today</h2>
        <p className="text-sm text-black/55">{new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: DENVER_TIME_ZONE }).format(now)}</p>
      </header>
      <div className="grid grid-cols-2 items-start gap-3 sm:gap-4 lg:grid-cols-12" aria-label="Operations dashboard">
        <section className={`${card} col-span-2 self-stretch bg-[var(--color-surface)] lg:col-span-6`} aria-labelledby="overview-people-heading">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 className="text-xl font-semibold" id="overview-people-heading">People</h2>
            {data.canPlaceMembers ? <Link className={textLink} href="/ops/members#allow-member-email">Add a member <span aria-hidden="true">+</span></Link> : null}
          </header>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-[var(--font-display)] text-5xl leading-none sm:text-6xl">{data.counts.activeMembers}</span>
            <span className="text-sm text-black/60">active members <span className="text-black/40">/ {data.counts.totalMembers} total</span></span>
          </div>
          <form action="/ops/members" method="get" role="search" aria-label="Find a member" className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <label className="sr-only" htmlFor="overview-member-search">Find a member</label>
            <input className="min-h-12 min-w-0 w-full rounded-[4px] border border-black/20 bg-[var(--color-bone)]/50 px-3 text-base placeholder:text-black/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black" id="overview-member-search" name="q" type="search" placeholder={data.canPlaceMembers ? "Name or email" : "Name"} maxLength={120} />
            <button className={OPERATOR_BUTTON_CLASS} type="submit">Find</button>
          </form>
          <nav aria-label="People actions" className="mt-2 flex flex-wrap items-center gap-x-5">
            <Link className={textLink} href="/ops/members">All members <span aria-hidden="true">→</span></Link>
            {data.counts.attentionRequired > 0 ? <Link className={`${textLink} text-[var(--color-poster)]`} href="/ops/members?filter=attention">{data.counts.attentionRequired} to review</Link> : null}
            {data.canPlaceMembers ? <Link className={`${textLink} text-black/60`} href="/ops/operators?add=1">Add an operator</Link> : null}
          </nav>
        </section>

        <section className={`${card} relative isolate flex h-full flex-col bg-[var(--color-shop)]/65 lg:col-span-3`} aria-labelledby="overview-circles-heading">
          <h2 className="text-lg font-semibold sm:text-xl" id="overview-circles-heading">{data.canPlaceMembers ? "Circles" : "Your Circles"}</h2>
          <div className="mt-5">
            <span className="font-[var(--font-display)] text-4xl leading-none sm:text-5xl">{data.counts.circles.active}</span>
            <span className="ml-2 text-sm text-black/60">active</span>
            {data.counts.circles.forming > 0 ? <p className="mt-2 text-sm text-black/60">{data.counts.circles.forming} forming</p> : null}
          </div>
          {data.canPlaceMembers && data.counts.eligibleWithoutCircle > 0 ? <Link className="relative z-10 mt-3 min-h-11 rounded-[4px] bg-white/35 px-3 py-2 text-sm leading-snug focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black" href="/ops/circles#assign-member">Ready for a Circle <strong className="block text-lg">{data.counts.eligibleWithoutCircle} <span aria-hidden="true">→</span></strong></Link> : null}
          <Link className={cardLink} href="/ops/circles">Manage Circles <span aria-hidden="true">→</span></Link>
        </section>

        <section className={`${card} relative isolate flex h-full flex-col bg-black/[0.035] lg:col-span-3`} aria-labelledby="overview-foundations-heading">
          <h2 className="break-words text-lg font-semibold sm:text-xl" id="overview-foundations-heading">Foundations</h2>
          <div className="mt-5">
            <span className="font-[var(--font-display)] text-4xl leading-none sm:text-5xl">{data.counts.foundations.inProgress}</span>
            <p className="mt-2 text-sm text-black/60">in progress</p>
          </div>
          <Link className={cardLink} href="/ops/foundations">Review progress <span aria-hidden="true">→</span></Link>
        </section>

        {attention.length > 0 ? <section className="col-span-2 grid grid-cols-2 gap-3 lg:col-span-12 lg:grid-cols-3" aria-label="Needs attention now">
          {attention.map(item => <Link key={item.href} href={item.href} className="flex min-w-0 items-start gap-3 rounded-[4px] bg-[var(--color-signal)]/20 px-4 py-3 transition-colors hover:bg-[var(--color-signal)]/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
            <span className="shrink-0 text-xl font-semibold tabular-nums">{item.count}</span>
            <span className="min-w-0"><span className="block text-sm leading-snug">{item.label} <span aria-hidden="true">↗</span></span>{item.oldestAt ? <span className="mt-1 block text-xs text-black/50">Oldest · {formatExperienceDate(item.oldestAt)}</span> : null}</span>
          </Link>)}
        </section> : null}

        <div className="col-span-2 grid grid-cols-2 items-start gap-3 sm:gap-4 lg:col-span-12 lg:grid-cols-12">
          <section className={`${card} col-span-2 bg-[var(--color-verdigris)] text-[var(--color-bone)] lg:col-span-5`} aria-labelledby="upcoming-heading">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2 className="text-xl font-semibold" id="upcoming-heading">Upcoming events</h2>
              <Link className={`${textLink} text-[var(--color-bone)]/80`} href="/ops/experiences">All events <span aria-hidden="true">→</span></Link>
            </header>
            <div className="mt-2 grid gap-1">
              {data.upcomingExperiences.map((experience) => <Link className="group rounded-[4px] py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current" href={`/ops/experiences/${experience.experienceId}`} key={experience.experienceId}>
                <span className="block text-xs text-[var(--color-bone)]/70">{formatExperienceDate(experience.startsAt)}</span>
                <span className="mt-1 block font-[var(--font-display)] text-2xl leading-tight group-hover:underline group-hover:underline-offset-4">{experience.title}</span>
              </Link>)}
              {data.upcomingExperiences.length === 0 ? <p className="py-4 text-sm text-[var(--color-bone)]/70">Nothing scheduled.</p> : null}
            </div>
          </section>

          <section className={`${card} col-span-2 bg-[var(--color-surface)] lg:col-span-5 lg:col-start-1`} aria-labelledby="priority-work-heading">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2 className="text-xl font-semibold" id="priority-work-heading">Needs a decision</h2>
              <Link className={textLink} href="/ops/work">{openWork} open <span aria-hidden="true">→</span></Link>
            </header>
            <div className="mt-3 grid gap-4">
              {data.priorityWork.map((item) => (
                <Link className="group grid gap-2 rounded-[4px] py-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black" href={workHref(item)} key={`${item.kind}-${item.workId}`}>
                  <span className="font-medium leading-tight group-hover:text-[var(--color-poster)]">{item.label}</span>
                  <span className="flex flex-wrap items-center justify-between gap-3 text-xs text-black/42">
                    <span>{item.memberName ?? (item.kind === "workflow_failure" ? "System" : "Operations")}</span>
                    <StateLabel state={item.state} />
                  </span>
                </Link>
              ))}
              {data.priorityWork.length === 0 ? <p className="py-2 text-sm text-black/55">{openWork > 0 ? "Open the work queue to review pending items." : "No open work."}</p> : null}
            </div>
          </section>

          <section className={`${card} col-span-2 bg-white/20 lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1`} aria-labelledby="recent-activity-heading">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h2 className="text-xl font-semibold" id="recent-activity-heading">Recent activity</h2>
              <span className="text-xs text-black/45">Last 90 days</span>
            </header>
            <div className="mt-5 grid gap-5">
              {groupedActivity.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-sm text-black/40">{group.label}</p>
                  <div className="grid gap-1">
                    {group.items.map((item) => {
                      const content = (
                        <>
                          <span aria-hidden="true" className={`mt-1.5 size-1.5 shrink-0 ${activityTone(item.tone)}`} />
                          <span className="min-w-0 break-words">
                            <span className="block text-sm font-semibold leading-snug">{item.subject}</span>
                            <span className="mt-1 block text-sm leading-snug text-black/55">{item.summary}</span>
                          </span>
                          <time className="text-xs tabular-nums text-black/35" dateTime={item.occurredAt}>{formatTime(item.occurredAt)}</time>
                        </>
                      );
                      const className = "-mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded-[4px] px-2 py-3 transition-colors hover:bg-black/[0.035] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";
                      return item.href ? (
                        <Link className={className} href={item.href} key={item.activityId}>{content}</Link>
                      ) : (
                        <div className={className} key={item.activityId}>{content}</div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {data.activity.length === 0 ? (
                <p className="py-3 text-sm text-black/55">No activity recorded in the last 90 days.</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </OperatorPageFrame>
  );
}
