"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ReferralReport = { joinedCount: number; joins: Array<{ memberId: string; name: string; joinedAt: string }> };
export default function OperatorMemberReferrals({ memberId, preview = false }: { memberId: string; preview?: boolean }) {
  const [open, setOpen] = useState(false), [report, setReport] = useState<ReferralReport | null>(null), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || preview) return;
    const controller = new AbortController();
    setError(""); setReport(null);
    fetch(`/api/ops/members/${encodeURIComponent(memberId)}/referrals`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok || typeof result.joinedCount !== "number" || !Array.isArray(result.joins)) throw new Error(result.error || "Invitation records could not be loaded.");
      setReport(result);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Invitation records could not be loaded."); });
    return () => controller.abort();
  }, [memberId, open, preview, retry]);
  return <details className="mt-5 rounded-lg border border-black/10 p-4" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">People joined through this member’s invitation</summary>
    {preview ? <p className="py-3 text-sm text-black/55">Invitation records appear here after members complete joining.</p> : error ? <div role="alert"><p className="text-sm text-red-800">{error}</p><button className="min-h-11 text-sm underline" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !report ? <p role="status" className="py-3 text-sm text-black/55">Loading invitation records…</p> : <>
      <p className="py-3 text-sm text-black/55">{report.joinedCount} completed {report.joinedCount === 1 ? "membership" : "memberships"}</p>
      {report.joins.length ? <ul className="divide-y divide-black/10">{report.joins.map(join => <li key={join.memberId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><Link className="min-h-11 max-w-full content-center break-words underline underline-offset-4" href={`/ops/members/${encodeURIComponent(join.memberId)}`}>{join.name} ↗</Link><time dateTime={join.joinedAt} className="text-xs text-black/50">{new Date(join.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time></li>)}</ul> : null}
      {report.joinedCount > report.joins.length ? <p className="text-xs text-black/50">Showing the {report.joins.length} most recent joined members.</p> : null}
    </>}
  </details>;
}
