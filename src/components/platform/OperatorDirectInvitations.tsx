"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OpsDirectInvitation, OpsDirectInvitationPage } from "@/lib/platform/ops-direct-invitations-repository";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "./operatorStyles";

const labels: Record<OpsDirectInvitation["status"], string> = {
  pending: "Pending", sent: "Sent", failed: "Email failed", accepted: "Accepted", joined: "Joined", expired: "Expired", revoked: "Cancelled",
};
const deliveries: Record<OpsDirectInvitation["deliveryStatus"], string> = {
  not_requested: "Not requested", queued: "Queued", sending: "Sending", sent: "Sent", failed: "Failed", cancelled: "Cancelled",
};
const date = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Denver", timeZoneName: "short" }).format(new Date(value));

export default function OperatorDirectInvitations({ data, directoryParams = {}, preview = false }: {
  data: OpsDirectInvitationPage | null; directoryParams?: Record<string, string>; preview?: boolean;
}) {
  const router = useRouter();
  function pageHref(page: number) {
    const params = new URLSearchParams({ ...directoryParams, directInvitationQ: data?.query ?? "", directInvitationPage: String(page) });
    return `/ops/members?${params.toString()}#direct-invitations`;
  }
  return <section id="direct-invitations" className="scroll-mt-32" aria-labelledby="direct-invitations-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="direct-invitations-title" className="ui-heading text-base font-semibold">Ruined Direct invitations</h3><button className="min-h-11 text-sm underline underline-offset-4" type="button" onClick={() => router.refresh()}>Refresh list</button></div>
    <p className="mt-2 max-w-3xl text-sm text-black/60">Personal invitations requested through online signup. These are tracked separately from member referrals. Accepted means email verified; Joined means membership activated.</p>
    {preview ? <p className="mt-2 text-xs text-black/60">Example records. No invitations were sent.</p> : null}
    {data ? <>
      <dl className="my-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{([['created', 'Created'], ['accepted', 'Accepted'], ['joined', 'Joined'], ['expired', 'Expired']] as const).map(([key, label]) => <div className="operator-bento-card" key={key}><dt className="text-xs text-black/60">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{data.counts[key]}</dd></div>)}</dl>
      {data.counts.failed > 0 ? <p className="mb-4 text-sm text-[var(--color-poster)]">{data.counts.failed} {data.counts.failed === 1 ? "invitation needs" : "invitations need"} email delivery attention.</p> : null}
      <form action="/ops/members#direct-invitations" method="get" className="flex flex-wrap gap-3">
        {Object.entries(directoryParams).map(([name, value]) => <input name={name} value={value} type="hidden" key={name} />)}
        <label className="min-w-0 flex-1"><span className="sr-only">Find direct invitation by name or email</span><input className={OPERATOR_FIELD_CLASS} type="search" name="directInvitationQ" defaultValue={data.query} maxLength={120} placeholder="Find name or email" /></label>
        <button className={OPERATOR_BUTTON_CLASS} type="submit">Find invitation</button>
      </form>
      <p className="my-4 text-sm text-black/60">{data.totalResults} {data.totalResults === 1 ? "invitation" : "invitations"}{data.query ? " matching your search" : ""}. Totals above include all Ruined Direct invitations.</p>
      <ul className="grid gap-3 md:grid-cols-2">{data.entries.map(entry => <li className="operator-bento-card min-w-0" key={entry.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{entry.recipientName}</p><p className="mt-1 break-all text-xs text-black/60">{entry.recipientEmail}</p></div><span className="rounded-[3px] bg-black/[0.06] px-2 py-1 text-xs">{labels[entry.status]}</span></div>
        <p className="mt-3 text-xs font-medium">{entry.sourceLabel} · {entry.billingPlan === "annual" ? "Annual" : "Monthly"}</p>
        <dl className="mt-3 space-y-1 text-xs text-black/60"><div><dt className="inline">Created </dt><dd className="inline"><time dateTime={entry.issuedAt}>{date(entry.issuedAt)}</time></dd></div><div><dt className="inline">Expires </dt><dd className="inline"><time dateTime={entry.expiresAt}>{date(entry.expiresAt)}</time></dd></div><div><dt className="inline">Email </dt><dd className="inline">{deliveries[entry.deliveryStatus]}{entry.sentAt ? ` · ${date(entry.sentAt)}` : ""}</dd></div>{entry.acceptedAt ? <div><dt className="inline">Accepted </dt><dd className="inline">{date(entry.acceptedAt)}</dd></div> : null}{entry.joinedAt ? <div><dt className="inline">Joined </dt><dd className="inline">{date(entry.joinedAt)}</dd></div> : null}</dl>
        {entry.acceptedMemberId && !preview ? <Link className="mt-2 inline-flex min-h-11 items-center text-xs underline underline-offset-4" href={`/ops/members/${encodeURIComponent(entry.acceptedMemberId)}`}>Member record ↗</Link> : null}
      </li>)}</ul>
      {!data.entries.length ? <p className="py-6 text-sm text-black/60">{data.query ? "No direct invitations match this search." : "No Ruined Direct invitations yet."}</p> : null}
      {data.pageCount > 1 ? <nav aria-label="Direct invitation pages" className="mt-4 flex items-center justify-between gap-4 text-sm">{data.page > 1 ? <Link className="inline-flex min-h-11 items-center underline" href={pageHref(data.page - 1)}>Previous</Link> : <span />}<span>{data.page} of {data.pageCount}</span>{data.page < data.pageCount ? <Link className="inline-flex min-h-11 items-center underline" href={pageHref(data.page + 1)}>Next</Link> : <span />}</nav> : null}
    </> : <p className="mt-4 text-sm text-[var(--color-poster)]" role="alert">Direct invitations could not be loaded. Refresh the list to try again.</p>}
  </section>;
}
