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
  const connectedServices = health.services.filter((service) => service.state === "connected").length;
  const servicesNeedingAttention = health.services.length - connectedServices;

  return (
    <OperatorPageFrame title="System">
      <dl
        aria-label="System snapshot"
        className="grid gap-6 bg-[#080605] px-6 py-6 text-[var(--color-bone)] sm:grid-cols-3 sm:px-8 sm:py-8"
      >
        {[
          ["Connected services", connectedServices, "text-[var(--color-verdigris)]"],
          ["Services needing attention", servicesNeedingAttention, servicesNeedingAttention > 0 ? "text-[var(--color-poster)]" : ""],
          ["Failed actions", health.workflowFailures.length, health.workflowFailures.length > 0 ? "text-[var(--color-poster)]" : ""],
        ].map(([label, value, tone]) => (
          <div key={label}>
            <dt className="text-sm text-white/48">{label}</dt>
            <dd className={`mt-2 font-[var(--font-display)] text-4xl leading-none tracking-[-0.03em] sm:text-5xl ${tone}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mt-8 space-y-3" aria-label="Connected services">
        {health.services.map((service) => (
          <article
            className="grid gap-4 bg-black/[0.025] px-5 py-6 transition-colors hover:bg-black/[0.055] sm:grid-cols-[minmax(12rem,0.6fr)_9rem_minmax(14rem,1fr)] sm:items-center sm:px-6"
            key={service.label}
          >
            <div>
              <h2 className="ui-heading text-lg font-semibold">{service.label}</h2>
              <p className="mt-2 text-sm text-black/45">{service.detail}</p>
            </div>
            <div className={service.state === "connected" ? "text-[var(--color-verdigris)]" : "text-[var(--color-poster)]"}>
              <StateLabel state={service.state} />
            </div>
            <p className="text-sm text-black/50">Last success · {formatDate(service.lastSucceededAt)}</p>
          </article>
        ))}
      </section>

      <section className="mt-10" aria-label="Failed automation actions">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm text-black/45">Automation</p>
            <h2 className="mt-2 text-3xl leading-none">Failed actions</h2>
          </div>
          <Link className="text-sm text-black/55 underline decoration-black/25 underline-offset-5 hover:text-black" href="/ops/work">
            Open all work
          </Link>
        </div>
        <div className="mt-5 space-y-3">
          {health.workflowFailures.map((failure) => (
            <article
              className="grid gap-5 bg-black/[0.025] px-5 py-6 transition-colors hover:bg-black/[0.055] sm:px-6 lg:grid-cols-[minmax(12rem,1fr)_8rem_10rem_minmax(12rem,0.7fr)] lg:items-center"
              key={failure.actionId}
            >
              <div>
                <h3 className="ui-heading text-base font-semibold">{failure.actionType.replaceAll("_", " ")}</h3>
                <p className="mt-2 text-xs text-black/42">{failure.errorCode}</p>
              </div>
              <p className="text-sm tabular-nums text-black/52">{failure.attempts} attempts</p>
              <div className="text-[var(--color-poster)]">
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
            <p className="bg-black/[0.025] px-5 py-10 text-sm text-black/50">
              No failed automation actions.
            </p>
          ) : null}
        </div>
      </section>
    </OperatorPageFrame>
  );
}
