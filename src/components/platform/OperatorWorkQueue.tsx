"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import {
  OperatorTaskAction,
  OperatorWorkflowRetryAction,
} from "@/components/platform/OperatorWorkActions";
import StateLabel from "@/components/platform/StateLabel";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";
import type { OpsWorkQueue } from "@/lib/platform/ops-model";

const WORK_FILTERS = [["all", "All work"], ["held_email", "Held emails"], ["task", "Tasks"], ["artifact", "Artifacts"], ["workflow_failure", "Failed actions"]] as const;

function workHref(view: string, filter: string, sort: string): string {
  const params = new URLSearchParams();
  if (view === "dismissed") params.set("view", view);
  if (filter !== "all") params.set("filter", filter);
  if (sort !== "priority") params.set("sort", sort);
  const query = params.toString();
  return `/ops/work${query ? `?${query}` : ""}`;
}

function formatDate(value: string | null): string {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function urgencyLabel(item: OpsWorkQueue["items"][number]): string {
  if (item.dueAt) {
    const due = new Date(item.dueAt);
    if (!Number.isNaN(due.getTime())) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      if (dueDay < today) return "Overdue";
      if (dueDay.getTime() === today.getTime()) return "Due today";
    }
  }
  if (item.priority >= 90) return "Urgent";
  if (item.priority >= 70) return "Up next";
  return "Open";
}

function isCircleSizeTask(item: OpsWorkQueue["items"][number]): boolean {
  return item.kind === "task" && (item.taskType === "circle.size_low" || item.taskType === "circle.size_high");
}

export default function OperatorWorkQueue({ queue, preview = false }: { queue: OpsWorkQueue; preview?: boolean }) {
  const router = useRouter();
  const dismissedView = queue.view === "dismissed";
  const view = dismissedView ? "dismissed" : "active";
  const filter = queue.filter ?? "all";
  const sort = queue.sort ?? "priority";
  const items = queue.items;
  const filtered = filter !== "all";
  const filterLabel = WORK_FILTERS.find(([value]) => value === filter)?.[1] ?? "work";
  return (
    <OperatorPageFrame title="Work">
      <header className="operator-record-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="operator-page-heading">{dismissedView ? "Dismissed tasks" : "Work queue"}</h2><p className="mt-1 text-xs text-[color:var(--operator-muted)]" aria-label={dismissedView ? "Dismissed work total" : "Open work totals"}>{dismissedView ? `${queue.totals.tasks} dismissed tasks` : `${queue.totals.tasks} tasks · ${queue.totals.artifacts} Artifacts · ${queue.totals.failures} failed actions`}</p></div>
        <Link className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4" href="/ops/members">Create a member task →</Link>
      </header>
      <nav className="mb-3 flex flex-wrap gap-2" aria-label="Work views">
        {[["active", "Active work"], ["dismissed", `Dismissed (${queue.totals.dismissedTasks ?? 0})`]].map(([value, label]) => (
          <Link className={`inline-flex min-h-11 items-center rounded-none border border-[var(--operator-line)] px-4 text-sm font-medium ${view === value ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "bg-[var(--operator-surface-muted)] text-[color:var(--operator-muted)]"}`} aria-current={view === value ? "page" : undefined} href={workHref(value, value === "dismissed" && (filter === "artifact" || filter === "workflow_failure") ? "all" : filter, sort)} key={value}>{label}</Link>
        ))}
      </nav>
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-[color:var(--operator-muted)]">{dismissedView ? "These tasks are out of active work. Restore a task if it needs attention again." : "Dismiss a task when it doesn’t need attention. This removes it from active work without marking its requirement complete."}</p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav className="flex flex-wrap gap-2" aria-label="Filter work">
          {WORK_FILTERS.filter(([value]) => !dismissedView || value === "all" || value === "held_email" || value === "task").map(([value, label]) => <Link className={`inline-flex min-h-11 items-center rounded-none px-4 text-sm ${filter === value ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "bg-[var(--operator-surface-muted)] text-[color:var(--operator-muted)]"}`} aria-current={filter === value ? "page" : undefined} key={value} href={workHref(view, value, sort)}>{label}</Link>)}
        </nav>
        <label className="block min-w-48 text-xs font-medium text-[color:var(--operator-muted)]" htmlFor="work-sort">Sort by
          <select className={`${OPERATOR_FIELD_CLASS} mt-1`} id="work-sort" value={sort} onChange={event => router.push(workHref(view, filter, event.currentTarget.value))}>
            <option value="priority">Priority</option>
            <option value="oldest">Oldest to newest</option>
            <option value="newest">Newest to oldest</option>
          </select>
        </label>
      </div>
      <p className="mt-3 text-xs text-[color:var(--operator-muted)]" role="status">{filtered ? `${items.length} ${filterLabel.toLowerCase()} shown. ` : ""}Oldest and newest use the date work was added.</p>

      <section className="mt-4 space-y-3" aria-label={dismissedView ? "Dismissed operator tasks" : "Prioritized operator work"}>
        {items.map((item) => (
          <article
            className="operator-bento-card grid scroll-mt-24 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            id={item.kind === "task" && item.heldEmail ? `held-email-${item.heldEmail.id}` : `work-${item.workId}`}
            key={`${item.kind}-${item.workId}`}
          >
            <div className="min-w-0">
              {item.kind === "task" && item.heldEmail ? <p className="mb-2"><span className="inline-flex rounded-none bg-[var(--operator-wait)] px-2 py-1 text-xs font-semibold text-[var(--color-faded)]">Held email</span></p> : null}
              <h2 className="break-words text-base font-semibold leading-snug">{item.label}</h2>
              {item.kind === "task" && item.heldEmail ? <div className="mt-2 max-w-3xl text-sm leading-relaxed text-[color:var(--operator-muted)]">{!item.label.toLocaleLowerCase().includes(item.heldEmail.title.toLocaleLowerCase()) ? <p className="font-medium">{item.heldEmail.title}</p> : null}<p className="mt-1 whitespace-pre-wrap break-words">{item.heldEmail.reason}</p></div> : null}
              <p className="mt-1 break-words text-sm text-[color:var(--operator-muted)]">
                {item.kind === "task" && item.circleId && isCircleSizeTask(item) ? (
                  <Link className="underline decoration-[color:var(--operator-ink)]/25 underline-offset-4 hover:text-[color:var(--operator-ink)]" href={`/ops/circles?circleId=${encodeURIComponent(item.circleId)}#circle-${item.circleId}`}>
                    {item.circleName?.trim() || "View Circle"}
                  </Link>
                ) : item.memberId ? (
                  <Link className="underline decoration-[color:var(--operator-ink)]/25 underline-offset-4 hover:text-[color:var(--operator-ink)]" href={`/ops/members/${item.memberId}${item.kind === "task" && (item.taskType === "registration.billing_review" || item.taskType?.startsWith("registration.checkpoint.")) ? "#membership" : "#record"}`}>
                    {item.memberName?.trim() || (item.kind === "task" ? item.memberEmail?.trim() : null) || "View member"}
                  </Link>
                ) : "System work"}
              </p>
              {item.kind === "task" ? <p className="mt-2 break-words text-sm font-medium text-[color:var(--operator-muted)]">{item.claimedByName ? `${isCircleSizeTask(item) ? "Assigned to" : "Claimed by"} ${item.claimedByName}` : "Unclaimed"}</p> : null}
              {item.kind === "task" && item.dismissedAt ? <p className="mt-2 text-sm text-[color:var(--operator-muted)]">Dismissed {formatDate(item.dismissedAt)}{item.dismissedByName ? ` by ${item.dismissedByName}` : ""}</p> : null}
              {item.kind === "task" && (isCircleSizeTask(item) || item.taskType === "registration.billing_review" || item.taskType?.startsWith("registration.checkpoint.")) && item.description ? <p className="mt-2 max-w-3xl whitespace-pre-wrap break-words text-sm leading-relaxed text-[color:var(--operator-muted)]">{item.description}</p> : null}
              {item.kind === "task" && item.taskType === "communications.cade_review" && item.description ? <details className="mt-3 max-w-3xl text-sm"><summary className="cursor-pointer py-2 font-medium">{item.heldEmail && !item.heldEmail.reviewHref ? item.heldEmail.reviewLabel : "Full communication and decisions"}</summary><p className="whitespace-pre-wrap break-words leading-relaxed text-[color:var(--operator-muted)]">{item.description}</p></details> : null}
              {item.kind === "task" && item.heldEmail?.reviewHref ? <Link className={`${OPERATOR_BUTTON_CLASS} mt-3 mb-1`} href={item.heldEmail.reviewHref}>{item.heldEmail.reviewLabel} →</Link> : null}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--operator-muted)]">
                <span className="capitalize">{item.kind.replaceAll("_", " ")}</span>
                <StateLabel state={item.kind === "task" && item.dismissedAt ? "dismissed" : item.state} />
                {!dismissedView ? <span className={['Overdue', 'Urgent'].includes(urgencyLabel(item)) ? 'text-[var(--operator-danger)]' : ''}>{urgencyLabel(item)}</span> : null}
                <span>{formatDate(item.dueAt)}</span>
                {item.createdAt ? <span>Added {formatDate(item.createdAt)}</span> : null}
              </div>
            </div>
            {item.kind === "task" ? (
              <OperatorTaskAction state={item.state} taskId={item.workId} claimedByName={item.claimedByName} claimedByCurrentOperator={item.claimedByCurrentOperator} dismissedAt={item.dismissedAt} expectedVersion={item.version} preview={preview} />
            ) : item.kind === "workflow_failure" ? (
              item.state === "failed" ? (
                <OperatorWorkflowRetryAction workflowActionId={item.workId} preview={preview} />
              ) : (
                <p className="max-w-sm text-sm text-[color:var(--operator-muted)]">Retry limit reached. Review the failure with an Administrator before taking further action.</p>
              )
            ) : (
              <Link
                className="inline-flex min-h-11 items-center justify-self-start text-sm font-medium underline decoration-[color:var(--operator-ink)]/30 underline-offset-4 hover:text-[color:var(--operator-ink)] lg:justify-self-end"
                href={`/ops/artifacts?focus=${encodeURIComponent(item.workId)}#artifact-${item.workId}`}
              >
                Open production record
              </Link>
            )}
          </article>
        ))}
        {items.length === 0 ? (
          <div className="grid gap-3">
            <OperatorEmptyState
              actionHref={filtered ? workHref(view, "all", sort) : dismissedView ? workHref("active", "all", sort) : "/ops"}
              actionLabel={filtered ? "Show all work" : dismissedView ? "Return to active work" : "Return to overview"}
              detail={filtered ? "Choose All work to see the other items in this view." : dismissedView ? "Tasks you dismiss will appear here while their underlying requirement is still open." : "There are no member tasks, Artifact jobs, or failed automations waiting for an operator."}
              eyebrow={dismissedView ? "Dismissed" : "All clear"}
              title={filtered ? `No ${filterLabel.toLowerCase()} in this view.` : dismissedView ? "No dismissed tasks." : "Nothing needs a decision."}
            />
            <nav aria-label="Continue working" className="flex flex-wrap gap-3">
              {[
                ["Members", "Review member records", "/ops/members"],
                ["Experiences", "Check the upcoming calendar", "/ops/experiences"],
                ["System", "Verify connected services", "/ops/system"],
              ].map(([label, detail, href]) => (
                <Link className="inline-flex min-h-11 items-center gap-2 rounded-none bg-[var(--operator-surface-muted)] px-4 text-sm transition-colors hover:bg-[var(--operator-surface-hover)]" href={href} key={href}>
                  <span>{label} →</span>
                  <span className="sr-only">{detail}</span>
                </Link>
              ))}
            </nav>
          </div>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
