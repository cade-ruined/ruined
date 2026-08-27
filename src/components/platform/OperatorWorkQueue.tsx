import Link from "next/link";

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

export default function OperatorWorkQueue({ queue }: { queue: OpsWorkQueue }) {
  return (
    <OperatorPageFrame title="Work">
      <dl
        className="grid gap-6 bg-[#080605] px-6 py-6 text-[var(--color-bone)] sm:grid-cols-3 sm:px-8 sm:py-8"
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

      <section className="mt-8 space-y-3" aria-label="Prioritized operator work">
        {queue.items.map((item) => (
          <article
            className="grid gap-5 bg-black/[0.025] px-5 py-6 transition-colors hover:bg-black/[0.055] sm:px-6 lg:grid-cols-[8rem_minmax(13rem,1fr)_10rem_minmax(13rem,0.75fr)] lg:items-center"
            key={`${item.kind}-${item.workId}`}
          >
            <div>
              <p className="text-sm capitalize text-black/45">
                {item.kind.replaceAll("_", " ")}
              </p>
              <p className="mt-2 text-sm tabular-nums text-black/55">
                Priority {item.priority}
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
              <OperatorTaskAction state={item.state} taskId={item.workId} />
            ) : item.kind === "workflow_failure" ? (
              item.state === "failed" ? (
                <OperatorWorkflowRetryAction workflowActionId={item.workId} />
              ) : (
                <p className="text-sm text-black/48 lg:text-right">Retry allowance exhausted. Create a new task.</p>
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
        {queue.items.length === 0 ? (
          <p className="bg-black/[0.025] px-5 py-10 text-sm text-black/50">
            No open operator work.
          </p>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
