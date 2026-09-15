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

export default function OperatorWorkQueue({ queue, preview = false }: { queue: OpsWorkQueue; preview?: boolean }) {
  const [kind, setKind] = useState("all");
  const items = queue.items.filter((item) => kind === "all" || item.kind === kind);
  return (
    <OperatorPageFrame title="Work">
      <header className="operator-record-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="operator-page-heading">Work queue</h2><p className="mt-1 text-xs text-black/55" aria-label="Open work totals">{queue.totals.tasks} tasks · {queue.totals.artifacts} Artifacts · {queue.totals.failures} failed actions</p></div>
        <Link className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4" href="/ops/members">Create a member task →</Link>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter work">
          {[["all", "All work"], ["task", "Tasks"], ["artifact", "Artifacts"], ["workflow_failure", "Failed actions"]].map(([value, label]) => <button className={`min-h-11 rounded-[4px] px-4 text-sm ${kind === value ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "bg-black/5 text-black/65"}`} aria-pressed={kind === value} key={value} onClick={() => setKind(value)} type="button">{label}</button>)}
        </div>
      </div>

      <section className="mt-4 space-y-3" aria-label="Prioritized operator work">
        {items.map((item) => (
          <article
            className="operator-bento-card grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            key={`${item.kind}-${item.workId}`}
          >
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold leading-snug">{item.label}</h2>
              <p className="mt-1 text-sm text-black/55">
                {item.memberId && item.memberName ? (
                  <Link className="underline decoration-black/25 underline-offset-4 hover:text-black" href={`/ops/members/${item.memberId}#record`}>
                    {item.memberName}
                  </Link>
                ) : "System work"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/55">
                <span className="capitalize">{item.kind.replaceAll("_", " ")}</span>
                <StateLabel state={item.state} />
                <span className={['Overdue', 'Urgent'].includes(urgencyLabel(item)) ? 'text-[var(--color-poster)]' : ''}>{urgencyLabel(item)}</span>
                <span>{formatDate(item.dueAt)}</span>
              </div>
            </div>
            {item.kind === "task" ? (
              <OperatorTaskAction state={item.state} taskId={item.workId} preview={preview} />
            ) : item.kind === "workflow_failure" ? (
              item.state === "failed" ? (
                <OperatorWorkflowRetryAction workflowActionId={item.workId} preview={preview} />
              ) : (
                <p className="max-w-sm text-sm text-black/60">Retry limit reached. Review the failure with an Administrator before taking further action.</p>
              )
            ) : (
              <Link
                className="inline-flex min-h-11 items-center justify-self-start text-sm font-medium underline decoration-black/30 underline-offset-4 hover:text-black lg:justify-self-end"
                href={`/ops/artifacts?focus=${encodeURIComponent(item.workId)}#artifact-${item.workId}`}
              >
                Open production record
              </Link>
            )}
          </article>
        ))}
        {queue.items.length > 0 && items.length === 0 ? <p className="rounded-[4px] bg-black/[0.025] p-5 text-sm text-black/55" role="status">No work in this category. Choose All work to see the remaining items.</p> : null}
        {queue.items.length === 0 ? (
          <div className="grid gap-3">
            <OperatorEmptyState
              actionHref="/ops"
              actionLabel="Return to overview"
              detail="There are no member tasks, Artifact jobs, or failed automations waiting for an operator."
              eyebrow="All clear"
              title="Nothing needs a decision."
            />
            <nav aria-label="Continue working" className="flex flex-wrap gap-3">
              {[
                ["Members", "Review member records", "/ops/members"],
                ["Experiences", "Check the upcoming calendar", "/ops/experiences"],
                ["System", "Verify connected services", "/ops/system"],
              ].map(([label, detail, href]) => (
                <Link className="inline-flex min-h-11 items-center gap-2 rounded-[6px] bg-black/[0.035] px-4 text-sm transition-colors hover:bg-black/[0.07]" href={href} key={href}>
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
