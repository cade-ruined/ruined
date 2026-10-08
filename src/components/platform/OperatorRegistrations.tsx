"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { OpsMemberRegistration } from "@/lib/membership/registration-model";
import { operatorMemberJourney } from "@/lib/membership/operator-registration-progress";
import { operatorRegistrationFollowUp } from "@/lib/membership/operator-registration-follow-up";
import OperatorMemberCheckpoints from "./OperatorMemberCheckpoints";
import OperatorInvitationDetails from "./OperatorInvitationDetails";
import OperatorRegistrationNextStep from "./OperatorRegistrationNextStep";
import { OPERATOR_BUTTON_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "./operatorStyles";

export type OperatorRegistrationRow = OpsMemberRegistration;

function deliveryLabel(value: string | null) {
  if (value === "sent") return "Sent";
  if (value === "manual_review") return "Needs review";
  if (value === "failed") return "Retry pending";
  if (value === "sending") return "Sending";
  if (value === "cancelled") return "Cancelled";
  return value ? "Queued" : "Not queued";
}
type NextStep = ReturnType<typeof operatorMemberJourney>["next"]["key"];
function memberJourney(row: OperatorRegistrationRow) {
  return row.progress ? operatorMemberJourney({ ...row.progress, state: row.state, registeredAt: row.registeredAt, ready: row.ready,
    profileGranted: row.state === "activated" || row.progress.profileGranted, profileGrantedAt: row.profileActivatedAt ?? row.progress.profileGrantedAt }) : null;
}
function readyForProfile(row: OperatorRegistrationRow) {
  return row.state === "registered" && row.ready && memberJourney(row)?.next.key === "profile";
}

export default function OperatorRegistrations({ rows: initialRows, preview = false }: { rows: OperatorRegistrationRow[]; preview?: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const latestRows = useRef(rows);
  latestRows.current = rows;
  const [filter, setFilter] = useState<"all" | NextStep>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<OperatorRegistrationRow[] | null>(null);
  const reviewPanel = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const busy = useRef(false);
  useEffect(() => { setRows(initialRows); setSelected(new Set()); setReview(null); }, [initialRows]);
  useEffect(() => { if (review?.length) reviewPanel.current?.focus(); }, [review]);
  const journeys = new Map(rows.map(row => [row.memberId, memberJourney(row)]));
  const matches = (row: OperatorRegistrationRow, key: "all" | NextStep) => key === "all" || (key === "review" ? !journeys.get(row.memberId) || journeys.get(row.memberId)?.next.key === "review" || Boolean(journeys.get(row.memberId)?.attention) : journeys.get(row.memberId)?.next.key === key);
  const visible = rows.filter(row => matches(row, filter));
  const ready = rows.filter(readyForProfile);
  function choose(memberId: string, checked: boolean) {
    if (busy.current || (checked && !ready.some(row => row.memberId === memberId))) return;
    setReview(null);
    setSelected(current => { const next = new Set(current); if (checked) next.add(memberId); else next.delete(memberId); return next; });
  }
  function reviewSelection() {
    setFailures([]); setMessage("");
    setReview(ready.filter(row => selected.has(row.memberId)));
  }
  async function activate() {
    if (preview || busy.current || !review?.length) return;
    const requests = review.filter(row => latestRows.current.some(current => current.memberId === row.memberId && current.version === row.version && readyForProfile(current)));
    if (requests.length !== review.length) {
      setReview(null); setSelected(new Set());
      setMessage("Registration progress changed. Review the current checkpoints before opening profiles.");
      return;
    }
    busy.current = true; setPending(true); setFailures([]);
    let opened = 0;
    const errors: string[] = [];
    for (const row of requests) {
      try {
        const response = await fetch(`/api/ops/members/${encodeURIComponent(row.memberId)}/registration`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "activate_profile", expectedVersion: row.version }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.registration?.memberId !== row.memberId || payload.registration.state !== "activated") {
          throw new Error(typeof payload?.error === "string" ? payload.error : "Opening the profile was not confirmed. Refresh to check its status.");
        }
        opened++;
        setRows(current => current.map(item => item.memberId === row.memberId ? { ...item, ...payload.registration, activationEmailStatus: "pending" } : item));
        setSelected(current => { const next = new Set(current); next.delete(row.memberId); return next; });
      } catch (error) {
        errors.push(`${row.name}: ${error instanceof Error ? error.message : "Could not confirm this change."}`);
      }
      setMessage(`${opened} profile${opened === 1 ? "" : "s"} opened. ${errors.length ? `${errors.length} need review.` : "Activation emails are queued."}`);
    }
    setFailures(errors); setReview(null); setPending(false); busy.current = false;
  }

  return <div className="mx-auto max-w-6xl">
    <Link href="/ops/members" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">← Members</Link>
    <header className="mb-6 mt-4 flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="operator-page-heading">Registrations</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-black/60">Five checkpoints. Your next action and the exact link to share. Complimentary payment steps count as complete.</p></div>
      <button type="button" className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => router.refresh()}>Refresh</button>
    </header>
    {preview ? <p className="mb-5 border-l-2 border-[var(--color-poster)] pl-3 text-sm">Preview only. These are sample registrations. No access changes or emails can be sent.</p> : null}
    <nav aria-label="Next registration step" className="mb-5 flex flex-wrap gap-2">
      {([['all', 'All'], ['email', 'Verify email'], ['information', 'Collect info'], ['payment', 'Collect payment'], ['profile', 'Grant profile'], ['complete', 'Complete'], ['review', 'Needs review']] as const).map(([key, label]) => <button type="button" className={`min-h-11 rounded px-3 text-xs ${filter === key ? 'bg-black text-white' : 'border border-black/15'}`} key={key} aria-pressed={filter === key} disabled={pending} onClick={() => { setFilter(key); setReview(null); setSelected(new Set()); }}>{label} <span className="ml-1 opacity-60">{rows.filter(row => matches(row, key)).length}</span></button>)}
    </nav>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <button type="button" className={OPERATOR_BUTTON_CLASS} disabled={pending || !visible.some(readyForProfile)} onClick={() => { setSelected(new Set(visible.filter(readyForProfile).map(row => row.memberId))); setReview(null); }}>Select ready registrations</button>
      <button type="button" className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={pending || !selected.size} onClick={reviewSelection}>Review {selected.size || "selected"} profile{selected.size === 1 ? "" : "s"}</button>
    </div>
    {review?.length ? <section ref={reviewPanel} tabIndex={-1} className="mb-6 border border-black/20 bg-white/40 p-5 focus:outline-none" aria-labelledby="profile-release-review">
      <h3 id="profile-release-review" className="text-lg font-semibold">Open {review.length} profile{review.length === 1 ? "" : "s"}?</h3>
      <p className="mt-2 text-sm text-black/65">These members will gain profile access and receive the profile-ready email. Billing stays unchanged.</p>
      <ul className="my-4 max-h-48 overflow-auto text-sm">{review.map(row => <li className="break-words py-1" key={row.memberId}>{row.name} · {row.email}</li>)}</ul>
      <div className="flex flex-wrap gap-3"><button type="button" className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={preview || pending} onClick={() => void activate()}>{pending ? "Opening profiles…" : "Open profiles & queue email"}</button><button type="button" className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => setReview(null)}>Cancel</button></div>
    </section> : null}
    {message ? <p className="my-4 text-sm" role="status">{message}</p> : null}
    {failures.length ? <div className="my-4 border-l-2 border-[var(--color-poster)] pl-3 text-sm" role="alert"><p>Refresh before trying any unconfirmed changes again.</p><ul>{failures.map(item => <li className="mt-2" key={item}>{item}</li>)}</ul></div> : null}
    <div className="divide-y divide-black/10 border-y border-black/15">
      {visible.map(row => {
        const journey = journeys.get(row.memberId) ?? null;
        return <article key={row.memberId} className="grid gap-4 py-5 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
        <div className="flex items-start gap-3">
          {readyForProfile(row) ? <input className="mt-1 size-5 accent-black" type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.memberId)} disabled={pending} onChange={event => choose(row.memberId, event.target.checked)} /> : <span className="w-5 shrink-0" aria-hidden="true" />}
          <div className="min-w-0"><div className="-my-1 flex items-center gap-1"><Link className="min-w-0 break-words font-semibold underline underline-offset-4" href={`/ops/members/${row.memberId}?returnTo=%2Fops%2Fregistrations`}>{row.name}</Link><OperatorInvitationDetails invitation={row.invitation} memberName={row.name} /></div><p className="break-all text-sm text-black/55">{row.email}</p>
          {row.coupleStatus && row.coupleStatus !== "none" ? <p className="mt-2 break-words text-xs leading-5"><strong>{row.coupleStatus === "paired" ? "Couple · confirmed" : "Couple · awaiting confirmation"}</strong><br />{row.couplePartnerEmail}</p> : null}
          <details className="mt-1 text-xs text-black/55"><summary className="min-h-9 cursor-pointer content-center">Email delivery</summary><p>Welcome: {deliveryLabel(row.welcomeStatus)}</p><p>Profile access: {deliveryLabel(row.activationEmailStatus)}</p></details>
          </div>
        </div>
        <div className="min-w-0">
          <OperatorMemberCheckpoints journey={journey} compact />
          {row.progress?.paymentExempt ? <p className="mt-2 text-xs text-black/55">Complimentary membership · No payment required.</p> : null}
          <OperatorRegistrationNextStep key={`${row.memberId}-${journey?.next.key}-${row.email}-${row.couplePartnerEmail ?? ""}`} action={operatorRegistrationFollowUp(row, journey)} disabled={pending} preview={preview} onReviewProfile={() => {
            if (busy.current || !readyForProfile(row)) return;
            setFailures([]); setMessage(""); setSelected(new Set([row.memberId])); setReview([row]);
          }} />
        </div>
      </article>; })}
      {!visible.length ? <p className="py-10 text-sm text-black/55">No registrations in this view.</p> : null}
    </div>
    <p className="mt-4 text-xs text-black/45">Showing up to 200 recent registrations. Existing members keep their current access.</p>
  </div>;
}
