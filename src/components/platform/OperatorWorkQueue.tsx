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
    <OperatorPageFrame
      eyebrow="Work"
      introduction="One ordered queue for member follow-up, Artifact production, and automation failures. Priority and due date determine what should move next."
      title="Work"
    >
      <section className="mt-14 grid border-y border-black/25 sm:grid-cols-3" aria-label="Open work totals">
        {[
          ["Tasks", queue.totals.tasks],
          ["Artifacts", queue.totals.artifacts],
          ["Automation failures", queue.totals.failures],
        ].map(([label, value], index) => (
          <div className={`py-6 sm:px-7 ${index > 0 ? "border-t border-black/15 sm:border-l sm:border-t-0" : ""}`} key={label}>
            <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">{label}</p>
            <p className="mt-5 text-5xl tracking-[-0.04em]">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-14 border-t border-black/25" aria-label="Prioritized operator work">
        {queue.items.map((item) => (
          <article
            className="grid gap-5 border-b border-black/15 py-6 lg:grid-cols-[7rem_minmax(13rem,1fr)_9rem_minmax(13rem,0.75fr)] lg:items-center"
            key={`${item.kind}-${item.workId}`}
          >
            <div>
              <p className="text-[0.6rem] font-medium uppercase tracking-[0.15em] text-black/38">{item.kind.replaceAll("_", " ")}</p>
              <p className="mt-2 text-sm tabular-nums text-black/55">Priority {item.priority}</p>
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
          <p className="border-b border-black/15 py-10 text-sm text-black/50">No open operator work.</p>
        ) : null}
      </section>

      <nav className="mt-16 grid border-y border-black/25 sm:grid-cols-3" aria-label="Related operating views">
        {[
          ["Artifacts", "/ops/artifacts", "Move earned Artifacts through production and fulfillment."],
          ["Announcements", "/ops/announcements", "Prepare member-facing updates with an explicit audience."],
          ["System", "/ops/system", "Inspect connected services and failed automations."],
        ].map(([label, href, detail], index) => (
          <Link className={`group py-6 sm:px-7 ${index > 0 ? "border-t border-black/15 sm:border-l sm:border-t-0" : ""}`} href={href} key={href}>
            <span className="ui-heading text-lg font-semibold">{label}</span>
            <span className="mt-3 block max-w-xs text-sm leading-relaxed text-black/50 group-hover:text-black/70">{detail}</span>
          </Link>
        ))}
      </nav>
    </OperatorPageFrame>
  );
}
