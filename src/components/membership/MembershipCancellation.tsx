"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SUPPORT_ACTION_CLASS, SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import type { PublicCancellationQuote } from "@/lib/stripe/cancellation-service";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";

export default function MembershipCancellation() {
  const [commitment, setCommitment] = useState<{ initialTermEndsAt: string; plan: string } | null>(null);
  const [quote, setQuote] = useState<PublicCancellationQuote | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<{ effectiveAt: string; invoiceUrl: string | null } | null>(null);
  useEffect(() => {
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
  }, [loadAttempt]);
  if (!commitment) {
    if (loadError) return <div className="mt-6 border-t border-[var(--member-line)] pt-5">
      <h3 className="text-lg font-semibold">Cancellation</h3>
      <p className="mt-2 text-sm leading-relaxed" role="alert">{loadError} You can also contact support to request cancellation.</p>
      <div className="mt-4 flex flex-wrap gap-4">
        <button type="button" className={SUPPORT_ACTION_CLASS} onClick={() => { setLoadError(""); setLoading(true); setLoadAttempt(value => value + 1); }}>Retry cancellation options</button>
        <Link href="/my/support" className={SUPPORT_LINK_CLASS}>Contact support</Link>
      </div>
    </div>;
    return loading ? <p className="mt-6 text-sm text-[var(--member-muted)]" role="status">Loading cancellation options…</p> : null;
  }
  async function request(action: "quote" | "confirm", intent?: "disable_renewal" | "early_exit") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/stripe/cancellation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "quote" ? { action, intent } : { action, quoteId: quote?.id, confirmed: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Billing is temporarily unavailable.");
      if (action === "quote") { setQuote(result.quote); setConfirmation(null); }
      else { setConfirmation(result.cancellation); setQuote(null); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Billing is temporarily unavailable."); }
    finally { setBusy(false); }
  }
  const initialMonthly = commitment.plan === "monthly" && Date.now() < Date.parse(commitment.initialTermEndsAt);
  return <div className="mt-6 border-t border-[var(--member-line)] pt-5">
    <h3 className="text-lg font-semibold">Cancellation</h3>
    <p className="mt-2 text-sm leading-relaxed text-[var(--member-muted)]">{initialMonthly
      ? "Your initial commitment ends " + date(commitment.initialTermEndsAt) + ". You can turn off renewal now; the remaining agreed installments continue until then."
      : "Turn off renewal to end your membership after the current paid term. Refund requests are reviewed individually."}</p>
    {!confirmation ? <div className="mt-4 flex flex-wrap gap-4">
      <button type="button" disabled={busy} className={SUPPORT_ACTION_CLASS} onClick={() => request("quote", "disable_renewal")}>Turn off renewal</button>
      {initialMonthly ? <button type="button" disabled={busy} className={SUPPORT_LINK_CLASS} onClick={() => request("quote", "early_exit")}>Review early exit</button> : null}
    </div> : null}
    {quote ? <div className="mt-5 rounded border border-[var(--member-line)] p-4" role="region" aria-label="Confirm cancellation">
      <p className="font-semibold">{quote.intent === "disable_renewal" ? "Turn off renewal" : "End the initial commitment early"}</p>
      <p className="mt-2 text-sm leading-relaxed">Membership ends {date(quote.effectiveAt)}.</p>
      <p className="mt-2 text-sm leading-relaxed">{quote.intent === "disable_renewal"
        ? initialMonthly ? "Cancellation fee: $0. Installments already agreed for the initial term remain due." : "Cancellation fee: $0. Access continues through the current paid term."
        : money(quote.feeDues) + " replaces the remaining " + money(quote.remainingInitialDues ?? 0) + " in initial-term dues. Tax: " + money(quote.feeTax) + ". Total: " + money(quote.feeTotal) + ". No additional remaining installments will be collected."}</p>
      {quote.accessThrough ? <p className="mt-2 text-sm">Paid access remains through {date(quote.accessThrough)}. The early-exit payment does not extend access.</p> : null}
      <p className="mt-2 text-sm">Founding benefits end when membership ends. Joining again requires a fresh eligibility check.</p>
      <div className="mt-4 flex flex-wrap gap-4">
        <button type="button" disabled={busy} className={SUPPORT_ACTION_CLASS} onClick={() => request("confirm")}>{busy ? "Processing…" : quote.intent === "early_exit" ? "Confirm exit — " + money(quote.feeTotal) : "Confirm renewal cancellation"}</button>
        <button type="button" disabled={busy} className={SUPPORT_LINK_CLASS} onClick={() => setQuote(null)}>Keep membership</button>
      </div>
    </div> : null}
    {confirmation ? <div className="mt-4 text-sm leading-relaxed" role="status">
      <p>Cancellation confirmed. Your membership is scheduled to end {date(confirmation.effectiveAt)}.</p>
      {confirmation.invoiceUrl ? <a className={SUPPORT_LINK_CLASS + " mt-3"} href={confirmation.invoiceUrl}>View and pay early-exit invoice</a> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-4 text-sm leading-relaxed">{error} <Link href="/my/support" className="underline underline-offset-4">Contact support</Link></p> : null}
  </div>;
}
