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
      <dl
        className="grid gap-6 rounded-[4px] bg-[#080605] px-6 py-6 text-[var(--color-bone)] sm:grid-cols-3 sm:px-8 sm:py-8"
        aria-label="Open work totals"
      >
        {[
          ["Tasks", queue.totals.tasks],
          ["Artifacts", queue.totals.artifacts],
          ["Automation failures", queue.totals.failures],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-white/48">{label}</dt>
            <dd className="mt-2 font-[var(--font-display)] text-4xl leading-none tracking-[-0.03em] sm:text-5xl">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter work">
          {[["all", "All work"], ["task", "Tasks"], ["artifact", "Artifacts"], ["workflow_failure", "Failed actions"]].map(([value, label]) => <button className={`min-h-11 rounded-[4px] px-4 text-sm ${kind === value ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "bg-black/5 text-black/65"}`} aria-pressed={kind === value} key={value} onClick={() => setKind(value)} type="button">{label}</button>)}
        </div>
        <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/ops/members">Find a member to create a task →</Link>
      </div>

      <section className="mt-8 space-y-3" aria-label="Prioritized operator work">
        {items.map((item) => (
          <article
            className="grid gap-5 rounded-[4px] bg-black/[0.025] px-5 py-6 transition-colors hover:bg-black/[0.055] sm:px-6 lg:grid-cols-[8rem_minmax(13rem,1fr)_10rem_minmax(13rem,0.75fr)] lg:items-center"
            key={`${item.kind}-${item.workId}`}
          >
            <div>
              <p className="text-sm capitalize text-black/45">
                {item.kind.replaceAll("_", " ")}
              </p>
              <p className={`mt-2 text-sm ${["Overdue", "Urgent"].includes(urgencyLabel(item)) ? "text-[var(--color-poster)]" : "text-black/55"}`}>
                {urgencyLabel(item)}
              </p>
            </div>
            <div>
              <h2 className="ui-heading text-lg font-semibold">{item.label}</h2>
              <p className="mt-2 text-sm text-black/45">
                {item.memberId && item.memberName ? (
                  <Link className="underline decoration-black/25 underline-offset-4 hover:text-black" href={`/ops/members/${item.memberId}#record`}>
                    {item.memberName}
                  </Link>
                ) : "System work"}
              </p>
            </div>
            <div>
              <StateLabel state={item.state} />
              <p className="mt-2 text-xs text-black/42">{formatDate(item.dueAt)}</p>
            </div>
            {item.kind === "task" ? (
              <OperatorTaskAction state={item.state} taskId={item.workId} preview={preview} />
            ) : item.kind === "workflow_failure" ? (
              item.state === "failed" ? (
                <OperatorWorkflowRetryAction workflowActionId={item.workId} preview={preview} />
              ) : (
                <p className="text-sm text-black/48 lg:text-right">Retry limit reached. Review the failure with an Administrator before taking further action.</p>
              )
            ) : (
              <Link
                className="justify-self-start text-[0.62rem] font-medium uppercase tracking-[0.14em] underline decoration-black/30 underline-offset-5 hover:text-black lg:justify-self-end"
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
            <nav aria-label="Continue working" className="grid gap-3 sm:grid-cols-3">
              {[
                ["Members", "Review member records", "/ops/members"],
                ["Experiences", "Check the upcoming calendar", "/ops/experiences"],
                ["System", "Verify connected services", "/ops/system"],
              ].map(([label, detail, href]) => (
                <Link className="rounded-[4px] bg-black/[0.025] p-5 transition-colors hover:bg-black/[0.07]" href={href} key={href}>
                  <span className="font-[var(--font-display)] text-2xl leading-none">{label}</span>
                  <span className="mt-2 block text-sm text-black/50">{detail} →</span>
                </Link>
              ))}
            </nav>
          </div>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
