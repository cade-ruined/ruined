import Link from "next/link";

import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";
import { memberTier } from "@/lib/membership/member-number";
import type { HistoricalMemberDirectoryPage } from "@/lib/platform/member-history-repository";

export function historicalDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  }).format(date);
}

export function deletionReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    account_removal: "Account removal", member_request: "Member request",
    test_account: "Test account", duplicate_account: "Duplicate account",
  };
  return labels[reason] ?? "Account deletion";
}

export function HistoricalMemberAccessDenied() {
  return <div className="mx-auto max-w-[88rem] py-6">
    <h2 className="operator-page-heading">Administrator access required</h2>
    <p className="mt-3 text-sm leading-relaxed text-black/60">Historical member records are available to administrators only.</p>
    <Link className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/ops/members">Back to members</Link>
  </div>;
}

function pageHref(directory: HistoricalMemberDirectoryPage, page: number) {
  const params = new URLSearchParams();
  if (directory.query) params.set("q", directory.query);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/ops/members/history${query ? `?${query}` : ""}`;
}

export default function OperatorHistoricalMemberDirectory({ directory, preview = false }: {
  directory: HistoricalMemberDirectoryPage;
  preview?: boolean;
}) {
  const first = directory.totalResults === 0 ? 0 : (directory.page - 1) * directory.pageSize + 1;
  const last = directory.totalResults === 0 ? 0 : first + directory.members.length - 1;
  return <section className="mx-auto max-w-[88rem]" aria-labelledby="historical-member-heading">
    <header className="operator-record-header mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="operator-page-heading" id="historical-member-heading">Historical members</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-black/60">Accounts that have been deleted. Membership, financial and audit history remain; these records are excluded from current member counts.</p>
      </div>
      <Link className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4" href="/ops/members">Current members</Link>
    </header>
    {preview ? <p className="mb-4 text-sm text-black/60">Preview only. No historical member data is loaded.</p> : null}
    <form action="/ops/members/history" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" method="get">
      <label className="min-w-0">
        <span className="sr-only">Search historical members</span>
        <input className={`${OPERATOR_FIELD_CLASS} mt-0`} defaultValue={directory.query} maxLength={120} name="q" placeholder="Name, tag, or member number" type="search" />
      </label>
      <button className={OPERATOR_BUTTON_CLASS} type="submit">Find</button>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-black/50">
      <p>{directory.totalResults === 0 ? "0 historical members" : `${first}–${last} of ${directory.totalResults} historical members`}</p>
      {directory.query ? <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/ops/members/history">Clear search</Link> : null}
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {directory.members.map((member) => {
        const tier = memberTier(member.memberNumber);
        return <Link className="operator-bento-card grid content-start gap-3 transition-colors hover:bg-black/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black" key={member.memberId} href={`/ops/members/history/${encodeURIComponent(member.memberId)}`} aria-label={`Open ${member.displayName}’s historical member record`}>
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold leading-tight">{member.displayName}</h3>
            {member.memberTag && member.displayName.toLowerCase() !== `@${member.memberTag}`.toLowerCase() ? <p className="mt-1 break-all text-sm text-[var(--color-poster)]">@{member.memberTag}</p> : null}
            {tier ? <p className="mt-2 text-xs text-black/60">{tier.label} · No. {tier.displayNumber}</p> : null}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-black/45">Joined</dt><dd className="mt-1">{historicalDate(member.joinedAt)}</dd></div>
            <div><dt className="text-xs text-black/45">Account deleted</dt><dd className="mt-1">{historicalDate(member.deletedAt)}</dd></div>
          </dl>
          <p className="text-xs text-black/50">{deletionReasonLabel(member.reason)}</p>
          <span className="flex min-h-11 items-center text-sm font-semibold">View historical record <span aria-hidden="true" className="ml-1">→</span></span>
        </Link>;
      })}
      {directory.members.length === 0 ? <p className="col-span-full py-5 text-sm text-black/50">{directory.query ? "No historical members match this search." : "No deleted accounts have been recorded."}</p> : null}
    </div>
    {directory.pageCount > 1 ? <nav aria-label="Historical member directory pages" className="flex flex-wrap items-center justify-between gap-3 py-5 text-sm">
      {directory.page > 1 ? <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={pageHref(directory, directory.page - 1)}>← Previous</Link> : <span />}
      <span className="text-black/50">Page {directory.page} of {directory.pageCount}</span>
      {directory.page < directory.pageCount ? <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={pageHref(directory, directory.page + 1)}>Next →</Link> : <span />}
    </nav> : null}
  </section>;
}
