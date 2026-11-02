"use client";

import Link from "next/link";
import { useState } from "react";

import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import {
  OperatorTaskAction,
  OperatorWorkflowRetryAction,
} from "@/components/platform/OperatorWorkActions";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsWorkQueue } from "@/lib/platform/ops-model";

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
  const [kind, setKind] = useState("all");
  const dismissedView = queue.view === "dismissed";
  const items = queue.items.filter((item) => dismissedView || kind === "all" || item.kind === kind);
  return (
    <OperatorPageFrame title="Work">
      <header className="operator-record-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="operator-page-heading">{dismissedView ? "Dismissed tasks" : "Work queue"}</h2><p className="mt-1 text-xs text-[color:var(--operator-muted)]" aria-label={dismissedView ? "Dismissed work total" : "Open work totals"}>{dismissedView ? `${queue.totals.tasks} dismissed tasks` : `${queue.totals.tasks} tasks · ${queue.totals.artifacts} Artifacts · ${queue.totals.failures} failed actions`}</p></div>
        <Link className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4" href="/ops/members">Create a member task →</Link>
      </header>
      <nav className="mb-3 flex flex-wrap gap-2" aria-label="Work views">
        {[["active", "Active work", "/ops/work"], ["dismissed", `Dismissed (${queue.totals.dismissedTasks ?? 0})`, "/ops/work?view=dismissed"]].map(([value, label, href]) => (
          <Link className={`inline-flex min-h-11 items-center rounded-none border border-[var(--operator-line)] px-4 text-sm font-medium ${dismissedView === (value === "dismissed") ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "bg-[var(--operator-surface-muted)] text-[color:var(--operator-muted)]"}`} aria-current={dismissedView === (value === "dismissed") ? "page" : undefined} href={href} key={value}>{label}</Link>
        ))}
      </nav>
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-[color:var(--operator-muted)]">{dismissedView ? "These tasks are out of active work. Restore a task if it needs attention again." : "Dismiss a task when it doesn’t need attention. This removes it from active work without marking its requirement complete."}</p>
      {!dismissedView ? <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter work">
          {[["all", "All work"], ["task", "Tasks"], ["artifact", "Artifacts"], ["workflow_failure", "Failed actions"]].map(([value, label]) => <button className={`min-h-11 rounded-none px-4 text-sm ${kind === value ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "bg-[var(--operator-surface-muted)] text-[color:var(--operator-muted)]"}`} aria-pressed={kind === value} key={value} onClick={() => setKind(value)} type="button">{label}</button>)}
        </div>
      </div> : null}

      <section className="mt-4 space-y-3" aria-label={dismissedView ? "Dismissed operator tasks" : "Prioritized operator work"}>
        {items.map((item) => (
          <article
            className="operator-bento-card grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            key={`${item.kind}-${item.workId}`}
          >
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold leading-snug">{item.label}</h2>
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
              {item.kind === "task" && item.taskType === "communications.cade_review" && item.description ? <details className="mt-3 max-w-3xl text-sm"><summary className="cursor-pointer py-2 font-medium">Full communication and decisions</summary><p className="whitespace-pre-wrap break-words leading-relaxed text-[color:var(--operator-muted)]">{item.description}</p></details> : null}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--operator-muted)]">
                <span className="capitalize">{item.kind.replaceAll("_", " ")}</span>
                <StateLabel state={item.kind === "task" && item.dismissedAt ? "dismissed" : item.state} />
                {!dismissedView ? <span className={['Overdue', 'Urgent'].includes(urgencyLabel(item)) ? 'text-[var(--operator-danger)]' : ''}>{urgencyLabel(item)}</span> : null}
                <span>{formatDate(item.dueAt)}</span>
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
        {queue.items.length > 0 && items.length === 0 ? <p className="rounded-none bg-[var(--operator-surface-muted)] p-5 text-sm text-[color:var(--operator-muted)]" role="status">No work in this category. Choose All work to see the remaining items.</p> : null}
        {queue.items.length === 0 ? (
          <div className="grid gap-3">
            <OperatorEmptyState
              actionHref={dismissedView ? "/ops/work" : "/ops"}
              actionLabel={dismissedView ? "Return to active work" : "Return to overview"}
              detail={dismissedView ? "Tasks you dismiss will appear here while their underlying requirement is still open." : "There are no member tasks, Artifact jobs, or failed automations waiting for an operator."}
              eyebrow={dismissedView ? "Dismissed" : "All clear"}
              title={dismissedView ? "No dismissed tasks." : "Nothing needs a decision."}
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
