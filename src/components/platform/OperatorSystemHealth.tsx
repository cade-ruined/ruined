import Link from "next/link";

import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { OperatorWorkflowRetryAction } from "@/components/platform/OperatorWorkActions";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsSystemHealth } from "@/lib/platform/ops-model";

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
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

export default function OperatorSystemHealth({ health, canRetry, preview = false }: { health: OpsSystemHealth; canRetry: boolean; preview?: boolean }) {
  const verifiedChecks = health.services.filter((service) => service.state === "verified").length;
  const servicesNeedingAttention = health.services.filter(service => ["failed", "delayed", "unavailable"].includes(service.state)).length;
  const awaitingVerification = health.services.filter(service => service.state === "configured").length;
  const attentionStates = ["failed", "delayed", "unavailable", "configured", "verified"];
  const services = [...health.services].sort((left, right) => attentionStates.indexOf(left.state) - attentionStates.indexOf(right.state));

  return (
    <OperatorPageFrame title="Settings">
      <header className="operator-record-header mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="operator-page-heading">Settings</h2><p className="mt-1 text-xs text-black/55" aria-label="System snapshot">{verifiedChecks} verified · <span className={servicesNeedingAttention ? "text-[var(--color-poster)]" : ""}>{servicesNeedingAttention} need attention</span> · {awaitingVerification} not live-checked</p></div><Link href="/ops/operators" className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">Operator access →</Link></header>

      <nav aria-label="System tasks" className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="#service-checks">Review services</a>
        <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="#failed-actions">Failed actions · {health.workflowFailures.length}</a>
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/ops/work">Open work queue →</Link>
      </nav>
      <section className="grid items-start gap-3 scroll-mt-28 md:grid-cols-2" id="service-checks" aria-label="Service checks and delivery queues">
        {services.map((service) => (
          <details
            className="operator-bento-card"
            open={["failed", "delayed", "unavailable"].includes(service.state)}
            key={service.label}
          >
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-2 font-semibold">{service.label}{service.mode ? <span className={`rounded-sm px-2 py-1 text-xs font-medium ${service.mode === 'test' ? 'bg-[#FFCA2C] text-black' : 'bg-black/5'}`}>{service.mode === 'test' ? 'Test mode' : 'Live mode'}</span> : null}</span>
              <span className={`text-sm ${service.state === 'verified' ? 'text-[var(--color-verdigris)]' : service.state === 'configured' ? 'text-black/60' : 'text-[var(--color-poster)]'}`}>{{ configured: "Configured", verified: "Verified", delayed: "Delayed", failed: "Needs review", unavailable: "Not configured" }[service.state]} <span aria-hidden="true">⌄</span></span>
            </summary>
            <div className="mt-2 grid gap-3 text-sm">
            <div>
              <p className="text-sm text-black/65">{service.detail}</p>
            </div>
            <div className="space-y-2 text-sm text-black/55">
              <p>{service.evidenceLabel} · {formatDate(service.lastSucceededAt)}</p>
              {service.pendingCount || service.failureCount ? <p>{service.pendingCount} pending · {service.failureCount} need review</p> : null}
              {service.oldestPendingAt ? <p>Oldest due · {formatDate(service.oldestPendingAt)}</p> : null}
              {service.href ? <Link className="inline-block py-2 underline underline-offset-4 hover:text-black" href={service.href}>Open {service.label === "Support email" ? "support queue" : service.label === "Google Calendar" ? "Experiences" : "controls"} →</Link> : null}
            </div>
            </div>
          </details>
        ))}
      </section>

      <section className="mt-5 scroll-mt-28" id="failed-actions" aria-label="Failed automation actions">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <h2 className="text-lg font-semibold">Failed actions</h2>
          <Link className="text-sm text-black/55 underline decoration-black/25 underline-offset-5 hover:text-black" href="/ops/work">
            Open all work
          </Link>
        </div>
        <div className="mt-3 space-y-3">
          {health.workflowFailures.map((failure) => (
            <article
              className="operator-bento-card grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_8rem_10rem_minmax(12rem,0.7fr)] lg:items-center"
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
                <OperatorWorkflowRetryAction workflowActionId={failure.actionId} preview={preview} />
              ) : (
                <p className="text-sm text-black/45 lg:text-right">{canRetry ? "Retry limit reached. Review the failure before taking further action." : "Ask an Administrator to review this failure."}</p>
              )}
            </article>
          ))}
          {health.workflowFailures.length === 0 ? (
            <p className="operator-bento-card text-sm text-black/55">
              No failed automation actions.
            </p>
          ) : null}
        </div>
      </section>
    </OperatorPageFrame>
  );
}
