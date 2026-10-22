"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import AgreementText from "@/components/membership/AgreementText";
import { OPERATOR_BUTTON_CLASS } from "@/components/platform/operatorStyles";
import { foundationsBillingScheduleForMonth } from "@/lib/membership/foundations-schedule";
import { formatMembershipPrice, MEMBERSHIP_OFFERS, type MembershipBillingPlan } from "@/lib/membership/pricing";
import {
  OPERATOR_MEMBERSHIP_AUTHORITY_TEXT, OPERATOR_MEMBERSHIP_AUTHORITY_VERSION,
  type OperatorMembershipQuote,
} from "@/lib/stripe/operator-membership-model";

type CheckoutStatus = { eligible: boolean; reason: string | null; paid: boolean; memberName: string; actorName: string; publishableKey: string | null };
const stripeClients = new Map<string, Promise<Stripe | null>>();
const date = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(value)) + " Mountain Time";
const expiry = (quote: OperatorMembershipQuote) => Math.min(Date.parse(quote.expiresAt), quote.billingSchedule ? Date.parse(quote.billingSchedule.cutoffAt) : Infinity);

export function OperatorEmbeddedCheckout({ clientSecret, publishableKey, onError, onComplete }: {
  clientSecret: string; publishableKey: string; onError: (error: string) => void; onComplete: () => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let checkout: Awaited<ReturnType<Stripe["createEmbeddedCheckoutPage"]>> | null = null;
    async function start() {
      if (!stripeClients.has(publishableKey)) stripeClients.set(publishableKey, loadStripe(publishableKey).catch(error => { stripeClients.delete(publishableKey); throw error; }));
      const stripe = await stripeClients.get(publishableKey);
      if (!stripe) { stripeClients.delete(publishableKey); throw new Error("Secure payment could not be loaded."); }
      const instance = await stripe.createEmbeddedCheckoutPage({ clientSecret, onComplete: () => { if (!cancelled) onComplete(); } });
      if (cancelled) { instance.destroy(); return; }
      checkout = instance;
      if (!mount.current) throw new Error("Secure payment could not be mounted.");
      instance.mount(mount.current);
    }
    void start().catch(error => { if (!cancelled) onError(error instanceof Error ? error.message : "Secure payment could not be loaded."); });
    return () => { cancelled = true; checkout?.destroy(); };
  }, [clientSecret, publishableKey, onError, onComplete]);
  return <div className="mt-5 min-h-[32rem] overflow-hidden bg-white" aria-label="Secure Stripe payment"><div ref={mount} /></div>;
}

function previewQuote(memberName: string, plan: MembershipBillingPlan): OperatorMembershipQuote {
  return {
    id: "preview-membership", reviewToken: "preview-review", expiresAt: "2026-11-04T22:00:00Z", firstChargeAt: null,
    billingSchedule: foundationsBillingScheduleForMonth("2026-11", plan),
    offer: MEMBERSHIP_OFFERS[plan === "annual" ? "founding_individual_annual" : "founding_individual_monthly"],
    agreement: { title: "Ruined Membership Agreement", version: "Preview", bodyText: "### Membership Agreement preview\n\nThe live form shows the exact published Membership Agreement for this member’s offer. This preview does not accept an agreement or authorize a payment." },
    memberName, actorName: "Preview Administrator", publishableKey: "preview-only", buyoutCap: 150000,
  };
}

export default function OperatorMemberCheckout({ memberId, memberName, preview = false }: { memberId: string; memberName: string; preview?: boolean }) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const refreshed = useRef(false);
  const [status, setStatus] = useState<CheckoutStatus | null>(preview ? { eligible: true, reason: null, paid: false, memberName, actorName: "Preview Administrator", publishableKey: "preview-only" } : null);
  const [plan, setPlan] = useState<MembershipBillingPlan>("monthly");
  const [planLocked, setPlanLocked] = useState(false);
  const [lockedPlan, setLockedPlan] = useState<MembershipBillingPlan | null>(null);
  const [quote, setQuote] = useState<OperatorMembershipQuote | null>(null);
  const [authority, setAuthority] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const [previewPayment, setPreviewPayment] = useState(false);
  const endpoint = `/api/ops/members/${encodeURIComponent(memberId)}/checkout`;

  useEffect(() => { if (!preview) setAwaiting(new URL(window.location.href).searchParams.get("membershipCheckout") === "returned"); }, [preview]);
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checks = 0;
    setLoading(true); setError(null); setSlow(false);
    async function check() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || typeof result.paid !== "boolean" || typeof result.eligible !== "boolean") throw new Error(result.error || "Membership billing could not be checked.");
        if (controller.signal.aborted) return;
        setStatus(result); setLoading(false);
        if (result.paid) {
          if (awaiting && !refreshed.current) { refreshed.current = true; router.refresh(); }
          return;
        }
      } catch (failure) {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(failure instanceof Error ? failure.message : "Membership billing could not be checked.");
        if (!awaiting) { setStatus(null); return; }
      }
      if (awaiting && ++checks < 20) timer = setTimeout(check, 1500);
      else if (awaiting) setSlow(true);
    }
    void check();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [endpoint, preview, awaiting, refreshKey, router]);

  useEffect(() => {
    if (!quote || preview || clientSecret) return;
    const remaining = expiry(quote) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) { setExpired(true); setAuthority(false); return; }
    setExpired(false);
    const timer = setTimeout(() => { setExpired(true); setAuthority(false); }, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [quote, preview, clientSecret]);

  async function review() {
    if (busy || awaiting || clientSecret || status?.paid || !status?.eligible) return;
    if (preview) { setQuote(previewQuote(memberName, plan)); setAuthority(false); return; }
    setBusy(true); setError(null); setAuthority(false); setPlanLocked(true);
    try {
      if (expired) requestId.current = null;
      requestId.current ??= crypto.randomUUID();
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "quote", requestId: requestId.current, plan }) });
      const result = await response.json();
      if (!response.ok || !result.quote) {
        if (result.code === "checkout_plan_locked" && (result.plan === "monthly" || result.plan === "annual")) {
          setPlan(result.plan); setLockedPlan(result.plan);
        }
        throw new Error(result.error || "The membership offer could not be prepared.");
      }
      const next = result.quote as OperatorMembershipQuote;
      if (!next.id || !next.reviewToken || !next.agreement?.bodyText || next.offer?.plan !== plan || !next.publishableKey) throw new Error("The membership offer could not be verified. Check the member’s billing before trying again.");
      setQuote(next); setExpired(expiry(next) <= Date.now()); setNeedsReview(false); setLockedPlan(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The membership offer could not be prepared."); }
    finally { setBusy(false); }
  }

  async function acceptAndPay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !authority || !quote || expired || needsReview || awaiting || clientSecret || status?.paid || !status?.eligible) return;
    if (preview) { setPreviewPayment(true); return; }
    if (expiry(quote) <= Date.now()) { setExpired(true); setAuthority(false); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "checkout", reservationId: quote.id, reviewToken: quote.reviewToken, authorityAccepted: true, authorityVersion: OPERATOR_MEMBERSHIP_AUTHORITY_VERSION }) });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "review_changed") { setNeedsReview(true); setAuthority(false); }
        throw new Error(result.error || "Secure payment could not be prepared.");
      }
      if (typeof result.clientSecret !== "string" || !result.clientSecret || result.plan !== quote.offer.plan || result.commercialReservationId !== quote.id) throw new Error("Secure payment did not match the reviewed offer. Check billing before trying again.");
      setClientSecret(result.clientSecret);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Secure payment could not be prepared."); }
    finally { setBusy(false); }
  }
  const completed = useCallback(() => { setAwaiting(true); setRefreshKey(value => value + 1); }, []);
  const amount = quote ? formatMembershipPrice(quote.offer.amount) : "";
  const schedule = quote?.billingSchedule;
  const deferred = Boolean(quote?.firstChargeAt && !schedule);
  const period = quote?.offer.plan === "annual" ? "year" : "month";

  return <section className="operator-bento-card mt-4" aria-label={`Complete membership for ${memberName}`}>
    <div className="mx-auto max-w-3xl">
      <h3 className="ui-heading text-lg font-semibold">Complete membership</h3>
      <p className="mt-2 text-sm leading-relaxed text-[color:var(--operator-muted)]">For {memberName}. Review the agreement on their behalf, then pay securely with Stripe. Your card will also cover renewals.</p>
      {preview ? <p className="mt-3 text-xs text-[color:var(--operator-muted)]" role="status">Preview only. No agreement is accepted and no card is charged.</p> : null}
      {loading ? <p className="mt-5 text-sm" role="status">Checking membership billing…</p> : status?.paid ? <div className="operator-glass mt-5 p-4" role="status"><p className="font-semibold">Membership payment confirmed</p><p className="mt-2 text-sm text-[color:var(--operator-muted)]">Payment is recorded for {memberName}. Profile access follows its separate release.</p></div> : awaiting ? <div className="mt-5 text-sm" role="status"><p>{slow ? "Confirmation is taking longer than usual." : "Waiting for Stripe payment confirmation…"}</p><p className="mt-2 text-[color:var(--operator-muted)]">We’ll update this record after payment is verified. Do not start another payment.</p><button className="mt-3 min-h-11 underline underline-offset-4" type="button" onClick={() => setRefreshKey(value => value + 1)}>Check payment confirmation</button></div> : !status?.eligible ? <div className="mt-5 text-sm"><p>{status?.reason ?? "Membership checkout is unavailable."}</p><button className="mt-2 min-h-11 underline underline-offset-4" type="button" onClick={() => setRefreshKey(value => value + 1)}>Check billing again</button></div> : <>
        {!quote ? <div className="mt-5">
          <fieldset className="grid grid-cols-2 gap-3" disabled={busy || planLocked}>
            <legend className="mb-2 text-sm font-medium">Payment schedule</legend>
            {(["monthly", "annual"] as const).map(option => <label className="operator-glass flex min-h-12 cursor-pointer items-center gap-2 p-3 text-sm has-[:checked]:outline-1 has-[:checked]:outline-[var(--operator-ink)]" key={option}><input type="radio" name={`operator-membership-plan-${memberId}`} checked={plan === option} onChange={() => { setPlan(option); requestId.current = null; setError(null); }} />{option === "monthly" ? "Pay monthly" : "Pay annually"}</label>)}
          </fieldset>
          <p className="mt-3 text-xs text-[color:var(--operator-muted)]">The next view shows this member’s exact price, Foundations dates, and agreement.</p>
          <button className={`${OPERATOR_BUTTON_CLASS} mt-4`} disabled={busy || (!preview && !status.publishableKey)} onClick={review} type="button">{busy ? "Loading membership offer…" : lockedPlan ? `Resume ${lockedPlan} membership` : "Review membership"}</button>
        </div> : <>
          <div className="operator-glass mt-5 p-4 sm:p-5" aria-label="Membership price and terms">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="operator-compact-label">{quote.offer.tier === "founding_individual" ? "Founding membership" : quote.offer.tier === "couple" ? "Couples membership" : "Individual membership"} · {quote.offer.plan}</p><p className="mt-2 text-4xl font-semibold tracking-tight">{deferred ? "$0" : amount}<span className="ml-2 text-sm font-normal">due today</span></p></div><p className="text-xs text-[color:var(--operator-muted)]">USD · Plus applicable tax</p></div>
            {schedule ? <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-[color:var(--operator-muted)]">Foundations &amp; service begin</dt><dd className="mt-1 font-medium">{date(schedule.serviceStartsAt)}</dd></div><div><dt className="text-[color:var(--operator-muted)]">Next payment</dt><dd className="mt-1 font-medium">{amount} + tax<br />{date(schedule.nextChargeAt)}</dd></div></dl> : deferred && quote.firstChargeAt ? <p className="mt-4 text-sm">First charge: {amount} + tax on {date(quote.firstChargeAt)}. Nothing is charged today.</p> : null}
            <p className="mt-4 text-sm leading-relaxed"><strong>12-month commitment.</strong> {quote.offer.plan === "monthly" ? `${amount} ${deferred ? "on the first charge date" : "today"}, then ${schedule ? "11" : "the remaining"} monthly installments. ${formatMembershipPrice(quote.offer.initialTermAmount)} total before tax. Renews monthly at ${amount} after the first year.` : `${amount} pays for the full year. Renews annually at ${amount}.`} Applicable tax is added.</p>
            <p className="mt-3 text-sm leading-relaxed text-[color:var(--operator-muted)]">{schedule ? "Cancel before service begins for a full refund, including tax. " : deferred ? "Cancel before the first charge with no fee. " : ""}{quote.offer.plan === "monthly" ? `After service begins, early exit replaces unpaid initial installments with the lower of ${formatMembershipPrice(quote.buyoutCap)} or those installments, plus required tax. Turning off renewal does not erase the commitment.` : "Turning off annual renewal stops the next year’s charge. After service begins, it does not automatically refund the prepaid year."}</p>
            {schedule ? <p className="mt-3 text-xs text-[color:var(--operator-muted)]">Initial commitment ends {date(schedule.initialTermEndsAt)}. Profile access opens separately.</p> : null}
          </div>
          {schedule ? <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer content-center font-medium">Foundations calls &amp; billing details</summary><div className="space-y-3 pb-3 leading-relaxed text-[color:var(--operator-muted)]"><ol className="space-y-2">{schedule.callStartsAt.map((call, index) => <li key={call}>{index + 1}. {date(call)}</li>)}</ol><p>Four live virtual sessions, 90 minutes each. The first payment covers the first {period} of service, through {date(schedule.prepaidThrough)}.</p><p>Complete payment before {date(schedule.cutoffAt)}. This offer expires {date(quote.expiresAt)}.</p><p>Manage renewal or cancellation through Membership billing or Ruined support. After service begins, refund requests are reviewed individually; applicable rights remain unchanged.</p>{quote.offer.tier === "founding_individual" ? <p>The Founding rate remains while membership is continuously active. Canceling before service begins preserves eligibility reserved at registration; leaving after service begins requires a new eligibility check when rejoining.</p> : null}</div></details> : null}
          <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer content-center font-medium">Read {quote.agreement.title} · {quote.agreement.version}</summary><div className="max-h-96 overflow-y-auto bg-[#151515] p-5 text-white" role="region" aria-label="Published membership agreement" tabIndex={0}><AgreementText body={quote.agreement.bodyText} /></div></details>
          <p className="mt-3 text-xs text-[color:var(--operator-muted)]">{clientSecret ? "Accepted" : "You’ll accept"} as {quote.actorName} on behalf of {quote.memberName}. The record retains your identity as the administrator.</p>
          {(expired || needsReview) && !clientSecret ? <div className="mt-4 text-sm" role="alert"><p>{expired ? "This offer has expired." : "The membership terms have changed."} Review the current offer before continuing.</p><button className={`${OPERATOR_BUTTON_CLASS} mt-3`} disabled={busy} onClick={review} type="button">Review current offer</button></div> : !clientSecret && !previewPayment ? <form className="mt-4" onSubmit={acceptAndPay}>
            <label className="flex items-start gap-3 text-sm leading-relaxed"><input className="mt-1 h-5 w-5 shrink-0 accent-[var(--operator-ink)]" type="checkbox" name="operator-membership-authority" checked={authority} disabled={busy} onChange={event => setAuthority(event.target.checked)} /><span>{OPERATOR_MEMBERSHIP_AUTHORITY_TEXT}</span></label>
            <button className={`${OPERATOR_BUTTON_CLASS} mt-4`} disabled={!authority || busy} type="submit">{busy ? "Opening secure payment…" : preview ? "Preview secure payment" : "Accept agreement & pay"}</button>
            <p className="mt-3 text-xs text-[color:var(--operator-muted)]">No charge until you confirm payment in Stripe. <a className="underline underline-offset-4" href="/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a></p>
          </form> : null}
          {clientSecret || previewPayment ? <p className="mt-4 text-sm text-[color:var(--operator-muted)]">Use your billing address for the card and {quote.memberName}’s address for shipping.</p> : null}
          {previewPayment ? <div className="mt-5 border border-black/15 bg-white p-6 text-[#171714]" aria-label="Preview secure payment"><p className="font-semibold">Secure Stripe payment</p><p className="mt-2 text-sm">Card entry and available payment methods appear here. An existing saved card can also be used.</p><div className="mt-5 border border-black/20 p-4 text-sm text-black/50">Card details · Preview only</div><button className="mt-5 min-h-12 w-full bg-[#171714] px-4 text-sm font-semibold text-white" disabled type="button">{deferred ? "Confirm future billing" : `Pay ${amount} + applicable tax`}</button><p className="mt-3 text-xs">Preview only. No agreement, subscription, or payment is created.</p></div> : clientSecret ? <OperatorEmbeddedCheckout key={mountKey} clientSecret={clientSecret} publishableKey={quote.publishableKey} onError={setError} onComplete={completed} /> : null}
        </>}
      </>}
      {error ? <div className="mt-4 text-sm text-[var(--operator-danger)]" role="alert"><p>{error}</p>{clientSecret && !awaiting ? <button className="mt-2 min-h-11 underline underline-offset-4" type="button" onClick={() => { setError(null); setMountKey(value => value + 1); }}>Reload secure payment</button> : null}</div> : null}
    </div>
  </section>;
}
