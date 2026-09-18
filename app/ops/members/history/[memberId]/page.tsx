import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { deletionReasonLabel, historicalDate, HistoricalMemberAccessDenied } from "@/components/platform/OperatorHistoricalMemberDirectory";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { memberTier } from "@/lib/membership/member-number";
import { getHistoricalMemberRecord, MemberHistoryRepositoryError, type HistoricalMemberRecord } from "@/lib/platform/member-history-repository";
import { getOperatorAccessContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Historical member record" };
export const dynamic = "force-dynamic";

function stateLabel(value: string | null) {
  return value ? value.replaceAll("_", " ") : "Not recorded";
}

export default async function HistoricalMemberRecordPage({ params }: {
  params: Promise<{ memberId: string }>;
}) {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state === "unavailable") return <PlatformUnavailable accessHref="/ops/access" />;
  if (context.role !== "ops_admin") return <OperatorPageFrame title="Historical member record"><HistoricalMemberAccessDenied /></OperatorPageFrame>;
  if (context.state === "preview") notFound();
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;
  const { memberId } = await params;
  let record: HistoricalMemberRecord | null;
  try {
    record = await getHistoricalMemberRecord(context.viewer.authUserId, memberId);
  } catch (error) {
    if (error instanceof MemberHistoryRepositoryError && error.status === 403) {
      return <OperatorPageFrame title="Historical member record"><HistoricalMemberAccessDenied /></OperatorPageFrame>;
    }
    console.error("Historical member record could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
  if (!record) notFound();
  const tier = memberTier(record.memberNumber);
  return <OperatorPageFrame title="Historical member record">
    <article className="mx-auto grid max-w-[88rem] gap-4">
      <header className="operator-record-header grid gap-3">
        <Link className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4" href="/ops/members/history">← Historical members</Link>
        <p className="operator-compact-label text-black/50">Historical membership · Account deleted</p>
        <h2 className="operator-page-heading break-words">{record.displayName}</h2>
        {record.memberTag && record.displayName.toLowerCase() !== `@${record.memberTag}`.toLowerCase() ? <p className="break-all text-sm text-[var(--color-poster)]">@{record.memberTag}</p> : null}
        {tier ? <p className="text-sm text-black/60">{tier.label} · No. {tier.displayNumber}</p> : null}
        <p className="max-w-2xl text-sm leading-relaxed text-black/60">This account was deleted and is excluded from current member counts. Membership, financial and audit history remain. This record is read-only.</p>
      </header>
      <p className="rounded-[4px] bg-black/[0.035] px-4 py-3 text-sm leading-relaxed text-black/65" role="status">
        {record.cleanupStatus === "completed" ? "Sign-in and uploaded-file cleanup is complete."
          : record.cleanupStatus === "processing" ? "Remaining sign-in and uploaded-file cleanup is in progress."
            : record.cleanupStatus === "pending" ? "Remaining sign-in and uploaded-file cleanup is pending. Automatic retries continue."
              : "Account data cleanup status is currently unavailable."}
      </p>
      <section aria-labelledby="historical-membership-details" className="operator-bento-card">
        <h3 className="ui-heading text-base font-semibold" id="historical-membership-details">Membership record</h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Joined", historicalDate(record.joinedAt)], ["Account deleted", historicalDate(record.deletedAt)],
            ["Reason", deletionReasonLabel(record.reason)], ["Account", stateLabel(record.accountState)],
            ["Billing", stateLabel(record.billingState)], ["Standing", stateLabel(record.standingState)],
          ].map(([label, value]) => <div key={label}><dt className="text-xs text-black/45">{label}</dt><dd className="mt-1 text-sm">{value}</dd></div>)}
          <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-black/45">Deleted by</dt><dd className="mt-1 break-words text-sm text-black/60">{record.deletedByName}</dd></div>
        </dl>
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section aria-labelledby="historical-state-history" className="operator-bento-card">
          <h3 className="ui-heading text-base font-semibold" id="historical-state-history">Membership history</h3>
          <p className="mt-1 text-xs text-black/45">Most recent 50 recorded changes.</p>
          <ol className="mt-4 grid gap-3">{record.membershipHistory.map((event) => <li className="border-t border-black/10 pt-3" key={event.id}>
            <p className="text-sm leading-relaxed">{stateLabel(event.dimension)}{event.previousState ? `: ${stateLabel(event.previousState)} → ` : ": "}{stateLabel(event.nextState)}</p>
            <p className="mt-1 text-xs text-black/45"><time dateTime={event.occurredAt}>{historicalDate(event.occurredAt)}</time> · {stateLabel(event.source)}</p>
            <p className="mt-1 break-words text-xs text-black/45">{event.actorName}</p>
          </li>)}</ol>
          {record.membershipHistory.length === 0 ? <p className="mt-4 text-sm text-black/50">No membership changes recorded.</p> : null}
        </section>
        <section aria-labelledby="historical-audit-history" className="operator-bento-card">
          <h3 className="ui-heading text-base font-semibold" id="historical-audit-history">Audit history</h3>
          <p className="mt-1 text-xs text-black/45">Most recent 50 actions. Private snapshots are not shown.</p>
          <ol className="mt-4 grid gap-3">{record.auditHistory.map((event) => <li className="border-t border-black/10 pt-3" key={event.id}>
            <p className="break-words text-sm leading-relaxed">{event.action.replaceAll("_", " ").replaceAll(".", " · ")}</p>
            <p className="mt-1 text-xs text-black/45"><time dateTime={event.occurredAt}>{historicalDate(event.occurredAt)}</time></p>
            <p className="mt-1 break-words text-xs text-black/45">{event.actorName}</p>
          </li>)}</ol>
          {record.auditHistory.length === 0 ? <p className="mt-4 text-sm text-black/50">No audit actions recorded.</p> : null}
        </section>
      </div>
    </article>
  </OperatorPageFrame>;
}
