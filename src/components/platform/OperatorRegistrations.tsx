"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { OpsMemberRegistration } from "@/lib/membership/registration-model";
import { operatorRegistrationStatus, type OperatorRegistrationStatus } from "@/lib/membership/operator-registration-progress";
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
function paymentStatus(row: OperatorRegistrationRow) {
  return operatorRegistrationStatus({ ...row,
    paymentMethodState: row.requiresPaymentMethod && row.ready ? "saved" : "missing",
    paymentConfirmed: Boolean(row.initialPayment), billingArranged: false, billingState: "pending", serviceStartsAt: null,
    ...row.progress, state: row.state, registeredAt: row.registeredAt, ready: row.ready,
  });
}
function viewState(row: OperatorRegistrationRow) {
  return row.state === "registered" && !row.ready ? "collecting" : row.state;
}

export default function OperatorRegistrations({ rows: initialRows, preview = false }: { rows: OperatorRegistrationRow[]; preview?: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<"all" | "registered" | "collecting" | "activated">("registered");
  const [statusFilter, setStatusFilter] = useState<"all" | OperatorRegistrationStatus["category"]>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<OperatorRegistrationRow[] | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const busy = useRef(false);
  useEffect(() => { setRows(initialRows); setSelected(new Set()); setReview(null); }, [initialRows]);
  const accessRows = rows.filter(row => filter === "all" || viewState(row) === filter);
  const statuses = new Map(rows.map(row => [row.memberId, paymentStatus(row)]));
  const visible = accessRows.filter(row => statusFilter === "all" || statuses.get(row.memberId)?.category === statusFilter);
  const ready = rows.filter(row => row.state === "registered" && row.ready);
  function choose(memberId: string, checked: boolean) {
    if (busy.current) return;
    setReview(null);
    setSelected(current => { const next = new Set(current); if (checked) next.add(memberId); else next.delete(memberId); return next; });
  }
  function reviewSelection() {
    setFailures([]); setMessage("");
    setReview(ready.filter(row => selected.has(row.memberId)));
  }
  async function activate() {
    if (preview || busy.current || !review?.length) return;
    const requests = [...review];
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
      <div><h2 className="operator-page-heading">Registrations</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-black/60">Payment and profile access are separate. Each member’s payment status and next step are shown below. Opening a profile queues its access email; it never charges their card.</p></div>
      <button type="button" className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => router.refresh()}>Refresh</button>
    </header>
    {preview ? <p className="mb-5 border-l-2 border-[var(--color-poster)] pl-3 text-sm">Preview only. These are sample registrations. No access changes or emails can be sent.</p> : null}
    <nav aria-label="Registration status" className="mb-5 flex flex-wrap gap-2">
      {([['registered', 'Awaiting profile access'], ['collecting', 'In progress'], ['activated', 'Profiles open'], ['all', 'All']] as const).map(([key, label]) => <button type="button" className={`min-h-11 rounded px-4 text-sm ${filter === key ? 'bg-black text-white' : 'bg-black/5'}`} key={key} aria-pressed={filter === key} disabled={pending} onClick={() => { setFilter(key); setReview(null); setSelected(new Set()); }}>{label} <span className="ml-1 opacity-60">{key === "all" ? rows.length : rows.filter(row => viewState(row) === key).length}</span></button>)}
    </nav>
    <nav aria-label="Payment and registration status" className="mb-5 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-semibold text-black/55">Next step</span>
      {([['all', 'All statuses'], ['information', 'Needs information'], ['payment', 'Needs payment'], ['paid', 'Paid'], ['complimentary', 'Complimentary'], ['review', 'Needs review']] as const).map(([key, label]) => <button type="button" className={`min-h-11 rounded px-3 text-xs ${statusFilter === key ? 'bg-black text-white' : 'border border-black/15'}`} key={key} aria-pressed={statusFilter === key} disabled={pending} onClick={() => { setStatusFilter(key); setReview(null); setSelected(new Set()); }}>{label} <span className="ml-1 opacity-60">{key === "all" ? accessRows.length : accessRows.filter(row => statuses.get(row.memberId)?.category === key).length}</span></button>)}
    </nav>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <button type="button" className={OPERATOR_BUTTON_CLASS} disabled={pending || !visible.some(row => row.state === "registered" && row.ready)} onClick={() => { setSelected(new Set(visible.filter(row => row.state === "registered" && row.ready).map(row => row.memberId))); setReview(null); }}>Select ready registrations</button>
      <button type="button" className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={pending || !selected.size} onClick={reviewSelection}>Review {selected.size || "selected"} profile{selected.size === 1 ? "" : "s"}</button>
    </div>
    {review?.length ? <section className="mb-6 border border-black/20 bg-white/40 p-5" aria-labelledby="profile-release-review">
      <h3 id="profile-release-review" className="text-lg font-semibold">Open {review.length} profile{review.length === 1 ? "" : "s"}?</h3>
      <p className="mt-2 text-sm text-black/65">These members will gain profile access and receive the profile-ready email. Billing stays unchanged.</p>
      <ul className="my-4 max-h-48 overflow-auto text-sm">{review.map(row => <li className="break-words py-1" key={row.memberId}>{row.name} · {row.email}</li>)}</ul>
      <div className="flex flex-wrap gap-3"><button type="button" className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={preview || pending} onClick={() => void activate()}>{pending ? "Opening profiles…" : "Open profiles & queue email"}</button><button type="button" className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => setReview(null)}>Cancel</button></div>
    </section> : null}
    {message ? <p className="my-4 text-sm" role="status">{message}</p> : null}
    {failures.length ? <div className="my-4 border-l-2 border-[var(--color-poster)] pl-3 text-sm" role="alert"><p>Refresh before trying any unconfirmed changes again.</p><ul>{failures.map(item => <li className="mt-2" key={item}>{item}</li>)}</ul></div> : null}
    <div className="divide-y divide-black/10 border-y border-black/15">
      {visible.map(row => {
        const status = statuses.get(row.memberId)!;
        return <article key={row.memberId} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,1.2fr)_10rem]">
        <div className="flex items-start gap-3">
          {row.state === "registered" && row.ready ? <input className="mt-1 size-5 accent-black" type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.memberId)} disabled={pending} onChange={event => choose(row.memberId, event.target.checked)} /> : <span className="w-5" aria-hidden="true" />}
          <div className="min-w-0"><Link className="inline-flex min-h-8 items-center font-semibold underline underline-offset-4" href={`/ops/members/${row.memberId}?returnTo=%2Fops%2Fregistrations`}>{row.name}</Link><p className="break-all text-sm text-black/55">{row.email}</p></div>
        </div>
        <div className="text-sm"><p className={`font-semibold ${status.attention ? "text-[var(--color-poster)]" : ""}`}>{status.label}</p><p className="mt-1 text-xs leading-relaxed text-black/55">{status.detail}</p><p className="mt-2 text-xs leading-relaxed text-black/65">{status.next}</p>{row.coupleStatus && row.coupleStatus !== "none" ? <p className="mt-2 break-words text-xs leading-5"><strong>{row.coupleStatus === "paired" ? "Couple · confirmed" : "Couple · awaiting confirmation"}</strong><br />{row.couplePartnerEmail}</p> : null}</div>
        <div className="text-xs leading-6 text-black/60"><p>Welcome: {deliveryLabel(row.welcomeStatus)}</p><p>Activation: {deliveryLabel(row.activationEmailStatus)}</p></div>
      </article>; })}
      {!visible.length ? <p className="py-10 text-sm text-black/55">No registrations in this view.</p> : null}
    </div>
    <p className="mt-4 text-xs text-black/45">Showing up to 200 recent registrations. Existing members keep their current access.</p>
  </div>;
}
