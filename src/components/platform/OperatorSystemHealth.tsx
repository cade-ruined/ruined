import Link from "next/link";

import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { OperatorWorkflowRetryAction } from "@/components/platform/OperatorWorkActions";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsSystemHealth } from "@/lib/platform/ops-model";

function formatDate(value: string | null): string {
  if (!value) return "No successful run recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No successful run recorded";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function OperatorSystemHealth({ health, canRetry }: { health: OpsSystemHealth; canRetry: boolean }) {
  return (
    <OperatorPageFrame
      eyebrow="System"
      introduction="Connected services, automation failures, and manual retry controls live here. Billing is a read-only projection; member history remains in the operating record."
      title="System"
    >
      <section className="mt-14 border-t border-black/25" aria-label="Connected services">
        {health.services.map((service) => (
          <article className="grid gap-4 border-b border-black/15 py-6 sm:grid-cols-[minmax(12rem,0.6fr)_9rem_minmax(14rem,1fr)] sm:items-center" key={service.label}>
            <div>
              <h2 className="ui-heading text-lg font-semibold">{service.label}</h2>
              <p className="mt-2 text-sm text-black/45">{service.detail}</p>
            </div>
            <StateLabel state={service.state} />
            <p className="text-sm text-black/50">Last success · {formatDate(service.lastSucceededAt)}</p>
          </article>
        ))}
      </section>

      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-black/25 pb-4">
          <div>
            <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Automation</p>
            <h2 className="mt-3 text-3xl leading-none">Failed actions</h2>
          </div>
          <Link className="text-[0.62rem] font-medium uppercase tracking-[0.14em] underline decoration-black/25 underline-offset-5 hover:text-black" href="/ops/work">
            Open all work
          </Link>
        </div>
        <div className="divide-y divide-black/15">
          {health.workflowFailures.map((failure) => (
            <article className="grid gap-5 py-6 lg:grid-cols-[minmax(12rem,1fr)_8rem_10rem_minmax(12rem,0.7fr)] lg:items-center" key={failure.actionId}>
              <div>
                <h3 className="ui-heading text-base font-semibold">{failure.actionType.replaceAll("_", " ")}</h3>
                <p className="mt-2 font-mono text-xs text-black/42">{failure.errorCode}</p>
              </div>
              <p className="text-sm tabular-nums text-black/52">{failure.attempts} attempts</p>
              <div>
                <StateLabel state={failure.state} />
                <p className="mt-2 text-xs text-black/42">{formatDate(failure.failedAt)}</p>
              </div>
              {canRetry && failure.state === "failed" ? (
                <OperatorWorkflowRetryAction workflowActionId={failure.actionId} />
              ) : (
                <p className="text-sm text-black/45 lg:text-right">Create a new operator task.</p>
              )}
            </article>
          ))}
          {health.workflowFailures.length === 0 ? (
            <p className="py-10 text-sm text-black/50">No failed automation actions.</p>
          ) : null}
        </div>
      </section>
    </OperatorPageFrame>
  );
}
