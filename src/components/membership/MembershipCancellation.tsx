"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SUPPORT_ACTION_CLASS, SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import type { PublicCancellationQuote } from "@/lib/stripe/cancellation-service";

import type { FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(value)) + " Mountain Time";

export type CancellationCommitment = { initialTermEndsAt: string; plan: string; startsAt?: string; installmentDues?: number; status?: "scheduled" | "active" | "canceled" | "review_required" | "pending_payment" | "refund_pending"; canCancelBeforeStart?: boolean; canceledBeforeStart?: boolean; billingSchedule?: FoundationsBillingSchedule | null; refundAmount?: number | null; refundStatus?: "pending" | "succeeded" | null; cancellationQuoteId?: string | null };

export default function MembershipCancellation({ initialCommitment, onCanceled }: { initialCommitment?: CancellationCommitment; onCanceled?: () => void } = {}) {
  const [commitment, setCommitment] = useState<CancellationCommitment | null>(initialCommitment ?? null);
  const [quote, setQuote] = useState<PublicCancellationQuote | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(!initialCommitment);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<{ effectiveAt: string; invoiceUrl: string | null; refundStatus?: "pending" | "succeeded"; refundAmount?: number } | null>(null);
  useEffect(() => {
    if (initialCommitment) return;
    const controller = new AbortController();
    fetch("/api/stripe/cancellation", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Your cancellation options could not be loaded.");
        if (!controller.signal.aborted) setCommitment(result.commitment ?? null);
      })
      .catch(failure => {
        if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : "Your cancellation options could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadAttempt, initialCommitment]);
  if (!commitment) {
    if (loadError) return <div className="mt-6 border-t border-[var(--member-line)] pt-5">
      <h3 className="text-lg font-semibold">Cancellation</h3>
      <p className="mt-2 text-sm leading-relaxed" role="alert">{loadError} You can also contact support to request cancellation.</p>
      <div className="mt-4 flex flex-wrap gap-4">
        <button type="button" className={SUPPORT_ACTION_CLASS} onClick={() => { setLoadError(""); setLoading(true); setLoadAttempt(value => value + 1); }}>Retry cancellation options</button>
        <Link href="mailto:connect@theruinedproject.com" className={SUPPORT_LINK_CLASS}>Contact support</Link>
      </div>
    </div>;
    return loading ? <p className="mt-6 text-sm text-[var(--member-muted)]" role="status">Loading cancellation options…</p> : null;
  }
  async function request(action: "quote" | "confirm", intent?: "disable_renewal" | "early_exit" | "cancel_before_start") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/stripe/cancellation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "quote" ? { action, intent } : { action, quoteId: quote?.id ?? commitment?.cancellationQuoteId, confirmed: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Billing is temporarily unavailable.");
      if (commitment?.billingSchedule && (intent === "cancel_before_start" || quote?.intent === "cancel_before_start" || commitment.status === "refund_pending")) {
        const refund = action === "quote" ? result.quote : result.cancellation;
        if (!Number.isSafeInteger(refund?.refundAmount) || refund.refundAmount <= 0 || action === "confirm" && !["pending", "succeeded"].includes(refund.refundStatus)) {
          throw new Error("Your cancellation and full refund could not be confirmed. Contact Ruined before starting another membership.");
        }
      }
      if (action === "quote") { setQuote(result.quote); setConfirmation(null); }
      else { setConfirmation(result.cancellation); if (result.cancellation.refundStatus !== "pending") { setQuote(null); onCanceled?.(); } }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Billing is temporarily unavailable."); }
    finally { setBusy(false); }
  }
  const scheduled = commitment.status === "scheduled";
  const prepaid = Boolean(commitment.billingSchedule);
  const refundPending = confirmation?.refundStatus === "pending" || (!confirmation && commitment.status === "refund_pending");
  if (commitment.status === "canceled") return <p className="mt-6 text-sm" role="status">{commitment.canceledBeforeStart ? prepaid && commitment.refundStatus === "succeeded" ? "Membership canceled and initial payment refunded. No membership payment is scheduled." : "Scheduled membership canceled. No membership payment is scheduled." : "This subscription is canceled. Contact Ruined about any existing invoice or a new membership."}</p>;
  if (commitment.status === "review_required") return <p className="mt-6 text-sm" role="alert">Your billing needs review. <a className="underline underline-offset-4" href="mailto:connect@theruinedproject.com">Contact Ruined</a> before making a new billing choice.</p>;
  if (refundPending) return <div className="mt-6 border-t border-[var(--member-line)] pt-5" role="status">
    <h3 className="text-lg font-semibold">Refund confirmation pending</h3>
    <p className="mt-2 text-sm leading-relaxed">Your initial payment refund{typeof (confirmation?.refundAmount ?? commitment.refundAmount) === "number" ? ` of ${money((confirmation?.refundAmount ?? commitment.refundAmount)!)}` : ""} is still being confirmed. Do not start another membership until the result is confirmed.</p>
    <button type="button" className={SUPPORT_ACTION_CLASS + " mt-4"} disabled={busy || !(quote?.id || commitment.cancellationQuoteId)} onClick={() => request("confirm")}>{busy ? "Checking…" : "Check refund status"}</button>
    <a className={SUPPORT_LINK_CLASS + " ml-4"} href="mailto:connect@theruinedproject.com">Contact Ruined</a>
    {error ? <p className="mt-3 text-sm" role="alert">{error}</p> : null}
  </div>;
  const initialMonthly = !scheduled && commitment.plan === "monthly" && Date.now() < Date.parse(commitment.initialTermEndsAt);
  return <div className="mt-6 border-t border-[var(--member-line)] pt-5">
    <h3 className="text-lg font-semibold">Cancellation</h3>
    <p className="mt-2 text-sm leading-relaxed text-[var(--member-muted)]">{scheduled && prepaid && commitment.startsAt ? "Your first period is paid. Service begins " + date(commitment.startsAt) + ". Cancel before service begins for a full refund of the initial payment, including tax, with no early-exit fee." : scheduled && commitment.startsAt ? "Your first payment is scheduled for " + date(commitment.startsAt) + ". Cancel before then with no charge or early-exit fee." : initialMonthly
      ? "Your initial commitment ends " + date(commitment.initialTermEndsAt) + ". You can turn off renewal now; the remaining agreed installments continue until then."
      : "Turn off renewal to end your membership after the current paid term. Refund requests are reviewed individually."}</p>
    {!confirmation ? <div className="mt-4 flex flex-wrap gap-4">
      {scheduled ? <button type="button" disabled={busy || !commitment.canCancelBeforeStart} className={SUPPORT_ACTION_CLASS} onClick={() => request("quote", "cancel_before_start")}>{prepaid ? "Review cancellation and refund" : "Cancel before first charge"}</button> : <button type="button" disabled={busy} className={SUPPORT_ACTION_CLASS} onClick={() => request("quote", "disable_renewal")}>Turn off renewal</button>}
      {initialMonthly ? <button type="button" disabled={busy} className={SUPPORT_LINK_CLASS} onClick={() => request("quote", "early_exit")}>Review early exit</button> : null}
    </div> : null}
    {quote ? <div className="mt-5 rounded border border-[var(--member-line)] p-4" role="region" aria-label="Confirm cancellation">
      <p className="font-semibold">{quote.intent === "cancel_before_start" ? prepaid ? "Cancel and refund initial payment" : "Cancel scheduled membership" : quote.intent === "disable_renewal" ? "Turn off renewal" : "End the initial commitment early"}</p>
      <p className="mt-2 text-sm leading-relaxed">{quote.intent === "cancel_before_start" ? prepaid ? "Cancel before service begins. Your subscription will be stopped and the full initial payment will be refunded." : "Your future membership payments will be canceled now." : `Membership ends ${date(quote.effectiveAt)}.`}</p>
      <p className="mt-2 text-sm leading-relaxed">{quote.intent === "cancel_before_start" ? prepaid ? `Cancellation fee: $0. Refund: ${money(quote.refundAmount ?? 0)}, including tax. No further initial-term installments will be collected.` : "Cancellation fee: $0. No initial-term installments will be collected." : quote.intent === "disable_renewal"
        ? initialMonthly ? "Cancellation fee: $0. Installments already agreed for the initial term remain due." : "Cancellation fee: $0. The current paid term remains covered; profile and program access follow their opening dates."
        : money(quote.feeDues) + " replaces the remaining " + money(quote.remainingInitialDues ?? 0) + " in initial-term dues. Tax: " + money(quote.feeTax) + ". Total: " + money(quote.feeTotal) + ". No additional remaining installments will be collected."}</p>
      {quote.accessThrough ? <p className="mt-2 text-sm">The current paid term remains covered through {date(quote.accessThrough)}. The early-exit payment does not extend the term or open profile access.</p> : null}
      <p className="mt-2 text-sm">{quote.intent === "cancel_before_start" ? "Your registration and any reserved founding eligibility remain saved. A later checkout requires a fresh review and payment authorization." : "Founding benefits end when membership ends. Joining again requires a fresh eligibility check."}</p>
      <div className="mt-4 flex flex-wrap gap-4">
        <button type="button" disabled={busy} className={SUPPORT_ACTION_CLASS} onClick={() => request("confirm")}>{busy ? "Processing…" : quote.intent === "cancel_before_start" ? prepaid ? "Confirm cancellation and refund" : "Confirm cancellation — $0" : quote.intent === "early_exit" ? "Confirm exit — " + money(quote.feeTotal) : "Confirm renewal cancellation"}</button>
        <button type="button" disabled={busy} className={SUPPORT_LINK_CLASS} onClick={() => setQuote(null)}>Keep membership</button>
      </div>
    </div> : null}
    {confirmation ? <div className="mt-4 text-sm leading-relaxed" role="status">
      <p>{prepaid && confirmation.refundStatus === "succeeded" ? `Membership canceled. Your initial payment of ${money(confirmation.refundAmount ?? commitment.refundAmount ?? 0)} has been refunded. No membership payment is scheduled.` : scheduled ? "Scheduled membership canceled. No membership payment is scheduled." : `Cancellation confirmed. Your membership is scheduled to end ${date(confirmation.effectiveAt)}.`}</p>
      {confirmation.invoiceUrl ? <a className={SUPPORT_LINK_CLASS + " mt-3"} href={confirmation.invoiceUrl}>View and pay early-exit invoice</a> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-4 text-sm leading-relaxed">{error} <Link href="mailto:connect@theruinedproject.com" className="underline underline-offset-4">Contact support</Link></p> : null}
  </div>;
}
