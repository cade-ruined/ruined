"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { LEADERSHIP_LABELS, LEADERSHIP_RESPONSIBILITIES, type LeadershipDirectory } from "@/lib/platform/leadership-model";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS, OPERATOR_PANEL_CLASS } from "@/components/platform/operatorStyles";
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 text-sm font-medium">{label}{children}</label>; }
function Reason() { return <Field label="Reason / notes"><textarea name="reason" required maxLength={1200} rows={2} className={OPERATOR_FIELD_CLASS} /></Field>; }
export default function OperatorLeadershipManager({ initialDirectory, preview = false }: { initialDirectory: LeadershipDirectory; preview?: boolean }) {
  const [directory, setDirectory] = useState(initialDirectory);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [circleId, setCircleId] = useState(directory.circles[0]?.id ?? "");
  const [memberId, setMemberId] = useState("");
  const [endId, setEndId] = useState("");
  const canService = directory.capabilities.includes("supporter_readiness");
  const canReimburse = directory.capabilities.includes("reimbursements");
  const active = directory.services.filter(s => !s.endedAt);
  const ending = active.find(s => s.id === endId);
  const coverage = directory.people.filter(p => p.authUserId !== ending?.authUserId && p.circleIds.includes(ending?.circleId ?? "") && directory.readiness.some(r => r.authUserId === p.authUserId && r.circleId === ending?.circleId));
  const candidates = directory.people.filter(p => p.circleIds.includes(circleId));
  const ready = directory.readiness.some(r => r.authUserId === memberId && r.circleId === circleId);
  async function submit(event: FormEvent<HTMLFormElement>, extras: Record<string, unknown> = {}) {
    event.preventDefault(); if (busy) return; setError(""); setMessage("");
    if (preview) { setMessage("Preview only. No accounts, service records, or payments were changed."); return; }
    const form = event.currentTarget;
    const body: Record<string, unknown> = { ...Object.fromEntries(new FormData(form)), ...extras };
    if (body.action === "start") body.temporary = body.temporary === "true";
    if (body.action === "request_reimbursement") {
      const rawAmount = String(body.amount ?? "");
      if (!/^\d+(\.\d{1,2})?$/.test(rawAmount)) { setError("Enter a USD amount with no more than two decimal places."); return; }
      body.amountMinor = Math.round(Number(rawAmount) * 100); body.currency = "USD"; delete body.amount;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/ops/leadership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "This change could not be saved.");
      setMessage(body.action === "process" ? "External payment recorded. No payment was sent by this app." : "Saved to the leadership record.");
      const refreshed = await fetch("/api/ops/leadership", { cache: "no-store" });
      const data = await refreshed.json();
      if (!refreshed.ok) throw new Error("Saved, but the updated records could not be loaded. Reload this page before another action.");
      setDirectory(data.directory);
      form.reset(); setMemberId(""); setEndId("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save this change."); }
    finally { setBusy(false); }
  }
  return <div className="grid min-w-0 gap-6">
    <p className="max-w-3xl text-sm leading-relaxed text-black/70">Circle Supporters serve their Circle with preparation, support, and room to step back. Tyler and Mitch oversee readiness and coverage. Libby owns routine placement and discretionary reimbursement decisions.</p>
    {preview ? <p className="rounded-none border border-black/20 bg-[var(--operator-info)] p-3 text-sm">Preview — explore the forms with sample records. Changes are not saved.</p> : null}
    <div aria-live="polite">{message ? <p role="status" className="border-l-2 border-black p-3 text-sm">{message}</p> : null}{error ? <p role="alert" className="border-l-2 border-red-700 p-3 text-sm text-red-800">{error}</p> : null}</div>
    <section className={`${OPERATOR_PANEL_CLASS} p-4 sm:p-6`} aria-labelledby="leadership-access">
      <h2 id="leadership-access" className="font-[var(--font-display)] text-2xl">Administrator access</h2>
      <p className="mt-2 text-sm text-black/65">Every active Administrator has all Leadership permissions. No additional assignment is required.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">{LEADERSHIP_RESPONSIBILITIES.map(capability => <li key={capability} className="min-w-0 border-t border-black/20 pt-3"><p className="text-sm font-semibold">{LEADERSHIP_LABELS[capability]}</p><p className="mt-1 text-sm text-black/65">Included with Administrator access</p></li>)}</ul>
    </section>
    <section className={`${OPERATOR_PANEL_CLASS} p-4 sm:p-6`} aria-labelledby="supporter-service"><h2 id="supporter-service" className="font-[var(--font-display)] text-2xl">Supporter service</h2><p className="mt-2 text-sm text-black/65">Observe, co-facilitate, lead, then debrief. Members must complete Foundations before readiness approval and service. Temporary coverage is optional when someone steps back.</p>
      {!canService ? <p className="mt-3 text-sm">Active Administrator access is required to manage readiness and coverage.</p> : <>
        <details className="mt-5"><summary className="cursor-pointer text-sm font-semibold">Prepare or start a Supporter</summary><form onSubmit={event => submit(event)} className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Circle"><select name="circleId" required value={circleId} onChange={e => { setCircleId(e.target.value); setMemberId(""); }} className={OPERATOR_FIELD_CLASS}>{directory.circles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Current Circle member"><select name="authUserId" required value={memberId} onChange={e => setMemberId(e.target.value)} className={OPERATOR_FIELD_CLASS}><option value="">Choose a member</option>{candidates.map(p => <option key={p.authUserId} value={p.authUserId}>{p.name}</option>)}</select></Field><Field label="Action"><select name="action" className={OPERATOR_FIELD_CLASS} key={`${circleId}:${memberId}`} defaultValue={ready ? "start" : "ready"}><option value="ready" disabled={ready}>Approve readiness</option><option value="start" disabled={!ready}>Start service</option></select></Field><Field label="Service type"><select name="temporary" className={OPERATOR_FIELD_CLASS}><option value="false">Ongoing Supporter</option><option value="true">Temporary coverage</option></select></Field><div className="sm:col-span-2"><Reason /></div><p className="text-xs text-black/65 sm:col-span-2">Membership terms must be explained before accepting service. Reimbursement is discretionary; serving does not grant free access.</p><button disabled={busy || !memberId} className={`${OPERATOR_BUTTON_CLASS} justify-self-start`}>Save Supporter decision</button></form></details>
        <details className="mt-5"><summary className="cursor-pointer text-sm font-semibold">End service / arrange coverage</summary><form onSubmit={event => submit(event, { action: "end" })} className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Active service"><select name="assignmentId" required value={endId} onChange={e => setEndId(e.target.value)} className={OPERATOR_FIELD_CLASS}><option value="">Choose a Supporter</option>{active.map(s => <option key={s.id} value={s.id}>{s.name} · {s.circleName}</option>)}</select></Field><Field label="Temporary coverage (optional)"><select name="coverAuthUserId" key={endId} className={OPERATOR_FIELD_CLASS}><option value="">End now; arrange coverage separately</option>{coverage.map(p => <option key={p.authUserId} value={p.authUserId}>{p.name}</option>)}</select></Field><div className="sm:col-span-2"><Reason /></div><button disabled={busy || !endId} className={`${OPERATOR_BUTTON_CLASS} justify-self-start`}>End service</button></form></details>
      </>}
      <ul className="mt-5 grid gap-3">{directory.services.map(s => <li key={s.id} className="border-t border-black/20 pt-3 text-sm"><p className="font-semibold">{s.name} <span className="font-normal">· {s.circleName}</span></p><p className="mt-1 text-black/65">{s.endedAt ? `Ended ${date(s.endedAt)}` : s.temporary ? "Temporary coverage" : "Active service"} · Started {date(s.startedAt)}</p>{s.reason ? <p className="mt-1 break-words text-black/65">{s.reason}</p> : null}</li>)}</ul>{!directory.services.length ? <p className="mt-4 text-sm">No Supporter service recorded yet.</p> : null}
    </section>
    {canReimburse ? <section className={`${OPERATOR_PANEL_CLASS} p-4 sm:p-6`} aria-labelledby="supporter-reimbursement"><h2 id="supporter-reimbursement" className="font-[var(--font-display)] text-2xl">Reimbursements</h2><p className="mt-2 max-w-3xl text-sm text-black/65">Eligibility comes from active service and does not guarantee reimbursement. Administrators approve or decline requests and record payments made separately. Historical service can be reviewed after someone steps down.</p>
      <details className="mt-5"><summary className="cursor-pointer text-sm font-semibold">Add reimbursement for review</summary><form onSubmit={event => submit(event, { action: "request_reimbursement" })} className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Supporter service"><select name="assignmentId" required defaultValue="" className={OPERATOR_FIELD_CLASS}><option value="" disabled>Choose a service period</option>{directory.services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.circleName} · {date(s.startedAt)}</option>)}</select></Field><Field label="Amount (USD)"><input name="amount" required inputMode="decimal" placeholder="499.00" className={OPERATOR_FIELD_CLASS} /></Field><Field label="Service from (UTC)"><input type="date" name="periodStart" required className={OPERATOR_FIELD_CLASS} /></Field><Field label="Service through (UTC)"><input type="date" name="periodEnd" required className={OPERATOR_FIELD_CLASS} /></Field><div className="sm:col-span-2"><Reason /></div><button disabled={busy} className={`${OPERATOR_BUTTON_CLASS} justify-self-start`}>Add for review</button></form></details>
      <ul className="mt-5 grid gap-5">{directory.reimbursements.map(r => <li key={r.id} className="min-w-0 border-t border-black/20 pt-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{r.name} · {r.circleName}</h3><p className="text-sm">{new Intl.NumberFormat("en-US", { style: "currency", currency: r.currency }).format(r.amountMinor / 100)} · {r.status}</p></div><p className="mt-1 text-sm text-black/65">{date(r.periodStart)} – {date(r.periodEnd)}</p><p className="mt-2 break-words text-sm">{r.reason}</p>{r.decisionReason ? <p className="mt-2 break-words text-sm">Decision: {r.decisionReason}</p> : null}{r.reference ? <p className="mt-2 break-words text-sm">Payment recorded {date(r.processedAt!)} · {r.reference}</p> : null}
        {r.status === "pending" ? <form onSubmit={event => submit(event, { reimbursementId: r.id })} className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Decision"><select name="action" className={OPERATOR_FIELD_CLASS}><option value="approve">Approve reimbursement</option><option value="reject">Decline reimbursement</option></select></Field><Reason /><button disabled={busy} className={`${OPERATOR_BUTTON_CLASS} justify-self-start`}>Record decision</button></form> : null}
        {r.status === "approved" ? <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Record completed external payment</summary><form onSubmit={event => submit(event, { action: "process", reimbursementId: r.id })} className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Payment reference"><input name="reference" required maxLength={160} className={OPERATOR_FIELD_CLASS} /></Field><Field label="Paid on (UTC)"><input name="processedAt" type="date" required className={OPERATOR_FIELD_CLASS} /></Field><Reason /><button disabled={busy} className={`${OPERATOR_BUTTON_CLASS} justify-self-start`}>Mark processed</button></form></details> : null}
      </li>)}</ul>{!directory.reimbursements.length ? <p className="mt-4 text-sm">No reimbursements recorded yet.</p> : null}
    </section> : <p className="text-sm text-black/70">Active Administrator access is required to view reimbursements.</p>}
  </div>;
}
