import Link from "next/link";

import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
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

  const snapshot = [
    { href: "/ops/members", label: "Active members", tone: "", value: data.counts.activeMembers },
    { href: "/ops/members?filter=attention", label: "Needs attention", tone: "text-[var(--color-poster)]", value: data.counts.attentionRequired },
    { href: "/ops/foundations", label: "Foundations moving", tone: "", value: data.counts.foundations.inProgress },
    { href: "/ops/members?filter=unassigned", label: "Without a Circle", tone: "", value: data.counts.eligibleWithoutCircle },
    { href: "/ops/work", label: "Open work", tone: "", value: openWork },
  ];

  return (
    <OperatorPageFrame title="Overview">
      <nav className="mt-14 grid grid-cols-2 bg-[#080605] text-[var(--color-bone)] lg:grid-cols-5" aria-label="Current membership snapshot">
        {snapshot.map((item, index) => (
          <Link
            className={`group min-h-24 px-5 py-5 transition-colors hover:bg-white/[0.055] sm:px-6 ${index === snapshot.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}
            href={item.href}
            key={item.label}
          >
            <p className="text-sm text-white/48 transition-colors group-hover:text-white/70">{item.label}</p>
            <p className={`mt-5 font-[var(--font-display)] text-5xl leading-none tracking-[-0.04em] ${item.tone}`}>
              {item.value}
            </p>
          </Link>
        ))}
      </nav>

      <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.55fr)]">
        <section aria-labelledby="recent-activity-heading">
          <div className="flex items-end justify-between gap-5">
            <h2 className="font-[var(--font-display)] text-3xl leading-none sm:text-4xl" id="recent-activity-heading">
              Recent activity
            </h2>
            <span className="text-sm text-black/40">Last 90 days</span>
          </div>

          <div className="mt-6 grid gap-7">
            {groupedActivity.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-sm text-black/40">{group.label}</p>
                <div className="grid gap-2">
                  {group.items.map((item) => {
                    const content = (
                      <>
                        <span aria-hidden="true" className={`mt-1.5 size-1.5 shrink-0 ${activityTone(item.tone)}`} />
                        <span className="min-w-0">
                          <span className="block font-[var(--font-display)] text-xl leading-none">{item.subject}</span>
                          <span className="mt-2 block text-sm leading-relaxed text-black/55">{item.summary}</span>
                        </span>
                        <time className="text-xs tabular-nums text-black/35" dateTime={item.occurredAt}>{formatTime(item.occurredAt)}</time>
                      </>
                    );
                    const className = "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-4 bg-black/[0.025] px-4 py-4 transition-colors hover:bg-black/[0.055] sm:px-5";
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
              <p className="bg-black/[0.025] px-5 py-8 text-sm text-black/48">No recent activity is visible.</p>
            ) : null}
          </div>
        </section>

        <aside className="grid content-start gap-8">
          <section className="bg-[var(--color-surface)] p-5 sm:p-6" aria-labelledby="priority-work-heading">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-[var(--font-display)] text-2xl" id="priority-work-heading">Needs a decision</h2>
              <Link className="text-sm text-black/45 underline decoration-black/25 underline-offset-4 hover:text-black" href="/ops/work">All work</Link>
            </div>
            <div className="mt-5 grid gap-4">
              {data.priorityWork.map((item) => (
                <Link className="group grid gap-2" href={workHref(item)} key={`${item.kind}-${item.workId}`}>
                  <span className="font-medium leading-tight group-hover:text-[var(--color-poster)]">{item.label}</span>
                  <span className="flex flex-wrap items-center justify-between gap-3 text-xs text-black/42">
                    <span>{item.memberName ?? (item.kind === "workflow_failure" ? "System" : "Operations")}</span>
                    <StateLabel state={item.state} />
                  </span>
                </Link>
              ))}
              {data.priorityWork.length === 0 ? <p className="text-sm text-black/45">No open work.</p> : null}
            </div>
          </section>

          <section className="bg-[#080605] p-5 text-[var(--color-bone)] sm:p-6" aria-labelledby="upcoming-heading">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-[var(--font-display)] text-2xl" id="upcoming-heading">Next</h2>
              <Link className="text-sm text-white/45 underline decoration-white/25 underline-offset-4 hover:text-white" href="/ops/experiences">Experiences</Link>
            </div>
            <div className="mt-5 grid gap-5">
              {data.upcomingExperiences.map((experience) => (
                <Link className="group" href={`/ops/experiences#experience-${experience.experienceId}`} key={experience.experienceId}>
                  <span className="block font-[var(--font-display)] text-xl leading-tight group-hover:text-[var(--color-poster)]">{experience.title}</span>
                  <span className="mt-2 block text-xs text-white/42">{formatExperienceDate(experience.startsAt)}</span>
                </Link>
              ))}
              {data.upcomingExperiences.length === 0 ? <p className="text-sm text-white/42">Nothing scheduled.</p> : null}
            </div>
          </section>

          <Link className="bg-[var(--color-poster)] px-5 py-5 text-sm font-medium text-white transition-colors hover:bg-[#080605]" href="/ops/members?filter=unassigned">
            Place {data.counts.eligibleWithoutCircle} eligible member{data.counts.eligibleWithoutCircle === 1 ? "" : "s"} into a Circle →
          </Link>
        </aside>
      </div>
    </OperatorPageFrame>
  );
}
