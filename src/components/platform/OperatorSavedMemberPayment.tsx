"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import AgreementText from "@/components/membership/AgreementText";
import { OPERATOR_BUTTON_CLASS } from "@/components/platform/operatorStyles";
import { OPERATOR_SAVED_PAYMENT_AUTHORITY_TEXT, OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION, type OperatorMembershipQuote } from "@/lib/stripe/operator-membership-model";

type Quote = OperatorMembershipQuote & { total: number; tax: number; paymentMethodLabel: string; authorityVersion: string };
type Result = { state: "paid" | "pending" | "requires_action" | "failed" | "review"; message: string };
type Status = { eligible: boolean; reason?: string | null; state?: string; result?: Result; memberName: string; actorName: string; paymentMethodLabel?: string | null };
const unresolvedStates = ["pending", "requires_action", "failed", "review"];
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/Denver" }).format(new Date(value));

export default function OperatorSavedMemberPayment({ memberId, memberName, preview = false }: { memberId: string; memberName: string; preview?: boolean }) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [authority, setAuthority] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/ops/members/${encodeURIComponent(memberId)}/saved-payment`;

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (response.ok && typeof data.eligible === "boolean" && !controller.signal.aborted) {
        setStatus(data);
        if (data.result) setResult(data.result);
      }
    }).catch(() => { /* The existing checkout remains available if this optional check fails. */ });
    return () => controller.abort();
  }, [endpoint, preview]);

  async function review() {
    if (busy || submitted) return;
    setBusy(true); setError(null); setAuthority(false);
    try {
      requestId.current ??= crypto.randomUUID();
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "quote", requestId: requestId.current }) });
      const data = await response.json();
      if (!response.ok || !data.quote) throw new Error(data.error || "The saved payment could not be reviewed.");
      const next = data.quote as Quote;
      if (!next.id || !next.reviewToken || !Number.isSafeInteger(next.total) || next.total <= 0 || !next.billingSchedule || next.authorityVersion !== OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION) throw new Error("The payment quote is incomplete. Check billing before continuing.");
      setQuote(next);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The payment could not be reviewed."); }
    finally { setBusy(false); }
  }

  async function collect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitted || !quote || !authority || evidence.trim().length < 20) return;
    if (Date.parse(quote.expiresAt) <= Date.now()) { setError("This quote expired. Review the current payment before continuing."); setQuote(null); requestId.current = null; return; }
    setBusy(true); setSubmitted(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "collect", reservationId: quote.id, reviewToken: quote.reviewToken,
        authorityAccepted: true, authorityVersion: OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION, authorizationEvidence: evidence.trim() }) });
      const data = await response.json();
      if (!response.ok || !["paid", "pending", "requires_action", "failed", "review"].includes(data.state)) throw new Error(data.error || "Payment could not be confirmed. Check billing before starting another payment.");
      setResult(data);
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Payment could not be confirmed. Check billing before starting another payment."); }
    finally { setBusy(false); }
  }

  async function check() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Billing could not be checked.");
      setStatus(data);
      if (data.state === "paid") { setResult({ state: "paid", message: "Stripe payment is confirmed and recorded for this member." }); router.refresh(); }
      else if (data.result) setResult(data.result);
      else setError(data.reason || "Payment is not confirmed. Review this member’s billing before starting another payment.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Billing could not be checked."); }
    finally { setBusy(false); }
  }

  const unresolved = unresolvedStates.includes(status?.state ?? "");
  if (preview || !status || (!status.eligible && !submitted && !unresolved)) return null;
  return <section className="operator-bento-card mt-4" aria-label={`Charge saved payment method for ${memberName}`}>
    <div className="mx-auto max-w-3xl">
      <h3 className="ui-heading text-lg font-semibold">Use their saved payment method</h3>
      <p className="mt-2 text-sm leading-relaxed text-[color:var(--operator-muted)]">Complete {memberName}’s monthly membership with their explicit authorization. The agreement and authorization are recorded under your administrator account.</p>
      {result ? <div className="operator-glass mt-5 p-4" role="status"><p className="font-semibold">{result.state === "paid" ? "Payment confirmed" : result.state === "requires_action" ? "Member authentication required" : result.state === "failed" ? "Payment was not collected" : "Payment needs confirmation"}</p><p className="mt-2 text-sm">{result.message}</p></div> : null}
      {!result && unresolved ? <p className="operator-glass mt-5 p-4 text-sm" role="status">{status.reason || "This payment needs review before another collection can begin."}</p> : null}
      {!submitted && status.eligible ? !quote ? <button type="button" className={`${OPERATOR_BUTTON_CLASS} mt-4`} onClick={review} disabled={busy}>{busy ? "Checking price and saved payment…" : "Review saved payment"}</button> : <>
        <div className="operator-glass mt-5 p-5">
          <p className="operator-compact-label">{quote.offer.tier === "founding_individual" ? "Founding membership" : "Individual membership"} · monthly</p>
          <p className="mt-2 text-4xl font-semibold tracking-tight">{money(quote.total)}<span className="ml-2 text-sm font-normal">charged today</span></p>
          <p className="mt-2 text-sm">{money(quote.offer.amount)} membership + {money(quote.tax)} tax · {quote.paymentMethodLabel}</p>
          <p className="mt-4 text-sm">Service begins {date(quote.billingSchedule!.serviceStartsAt)}. Next payment: {money(quote.offer.amount)} + applicable tax on {date(quote.billingSchedule!.nextChargeAt)}.</p>
          <p className="mt-3 text-sm"><strong>12-month commitment.</strong> {money(quote.offer.initialTermAmount)} before tax, including today’s first payment and 11 monthly installments. Renews monthly after the first year.</p>
          <p className="mt-3 text-sm text-[color:var(--operator-muted)]">Cancel before service begins for a full refund. After service begins, early exit replaces unpaid initial installments with the lower of $1,500 or those installments, plus required tax. Profile access opens separately.</p>
        </div>
        <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer content-center font-medium">Read {quote.agreement.title} · {quote.agreement.version}</summary><div className="max-h-96 overflow-y-auto bg-[#151515] p-5 text-white" role="region" aria-label="Saved payment membership agreement" tabIndex={0}><AgreementText body={quote.agreement.bodyText} /></div></details>
        <form onSubmit={collect} className="mt-4 space-y-4">
          <label className="block text-sm font-medium">Member authorization record<textarea className="mt-2 block min-h-28 w-full rounded border border-current/25 bg-transparent p-3 text-sm font-normal" value={evidence} minLength={20} maxLength={1500} required disabled={busy} onChange={event => setEvidence(event.target.value)} placeholder="Record when and how they authorized you to accept the agreement and charge this payment method for their first payment and renewals." /></label>
          <p className="text-xs text-[color:var(--operator-muted)]">Recorded as {quote.actorName} for {quote.memberName}. Do not include card numbers or security codes.</p>
          <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--operator-ink)]" checked={authority} required disabled={busy} onChange={event => setAuthority(event.target.checked)} /><span>{OPERATOR_SAVED_PAYMENT_AUTHORITY_TEXT}</span></label>
          <button type="submit" className={OPERATOR_BUTTON_CLASS} disabled={busy || !authority || evidence.trim().length < 20}>{busy ? "Confirming payment…" : `Accept on their behalf & charge ${money(quote.total)}`}</button>
          <p className="text-xs text-[color:var(--operator-muted)]">This charges their saved payment method now and uses it for recurring renewals. A bank or Link authentication request must be completed by the member.</p>
        </form>
      </> : null}
      {(submitted || unresolved) && result?.state !== "paid" ? <button type="button" className="mt-4 min-h-11 underline underline-offset-4" disabled={busy} onClick={check}>Check payment status</button> : null}
      {error ? <p className="mt-4 text-sm text-[var(--operator-danger)]" role="alert">{error}</p> : null}
    </div>
  </section>;
}
