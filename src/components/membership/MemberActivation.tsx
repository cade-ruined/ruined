"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import JoinForm from "@/components/membership/JoinForm";
import MembershipCancellation, { type CancellationCommitment } from "@/components/membership/MembershipCancellation";
import type { MemberOnboardingSnapshot } from "@/lib/membership/model";
import { formatMembershipPrice, MEMBERSHIP_OFFERS, type MembershipBillingPlan } from "@/lib/membership/pricing";

import type { FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";

const scheduleDate = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(value)) + " Mountain Time";
const longDate = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/Denver" }).format(new Date(value));
const linkClass = "inline-flex min-h-11 items-center text-sm underline underline-offset-4";

type Props = {
  onboarding: MemberOnboardingSnapshot;
  enabled: boolean;
  disabledReason: string | null;
  initialPlan: MembershipBillingPlan;
  firstChargeAt: string | null;
  billingSchedule?: FoundationsBillingSchedule | null;
  minimumAge: number;
  publishableKey: string | null;
  returnedFromCheckout?: boolean;
  completingRegistration?: boolean;
  preview?: boolean;
  previewView?: "offer" | "agreement" | "scheduled" | "canceled";
};

/** A return URL is only a cue to refresh. Billing status comes from the server. */
export default function MemberActivation({ onboarding, enabled, disabledReason, initialPlan, firstChargeAt, billingSchedule, minimumAge,
  publishableKey, completingRegistration = false, returnedFromCheckout = false, preview = false, previewView = "offer" }: Props) {
  const previewCommitment: CancellationCommitment | null = preview && ["scheduled", "canceled"].includes(previewView)
    ? { startsAt: billingSchedule?.serviceStartsAt ?? firstChargeAt ?? "2026-11-01T06:00:00.000Z", initialTermEndsAt: billingSchedule?.initialTermEndsAt ?? "2027-11-01T06:00:00.000Z", plan: initialPlan, billingSchedule, refundStatus: billingSchedule && previewView === "canceled" ? "succeeded" : null,
      installmentDues: initialPlan === "annual" ? 349000 : 34900, status: previewView === "canceled" ? "canceled" : "scheduled", canCancelBeforeStart: true, canceledBeforeStart: previewView === "canceled" } : null;
  const [commitment, setCommitment] = useState<CancellationCommitment | null>(previewCommitment);
  const [loading, setLoading] = useState(!preview);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [reviewAgain, setReviewAgain] = useState(false);
  const [confirmationSlow, setConfirmationSlow] = useState(false);
  const confirmationNavigation = useRef(false);
  const refreshStatus = useCallback(() => { setLoading(true); setLoadError(null); setRefresh(value => value + 1); }, []);

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    fetch("/api/stripe/cancellation", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Your membership billing could not be loaded.");
        if (!controller.signal.aborted) setCommitment(payload.commitment ?? null);
      })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Your membership billing could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [preview, refresh]);

  const future = !billingSchedule && firstChargeAt ? longDate(firstChargeAt) : null;
  const previewOnboarding = preview ? { ...onboarding, requiredFieldsComplete: true, agreement: { ...onboarding.agreement,
    acceptanceId: previewView === "agreement" ? null : "preview-acceptance",
    body: "### Membership agreement preview\n\nThis is a layout preview. The live page displays the exact published membership agreement for review and acceptance. No agreement is accepted here.\n\n" +
      "| Membership and payment option | First payment, before tax | Initial 12-month price | Renewal |\n| --- | --- | --- | --- |\n" +
      Object.values(MEMBERSHIP_OFFERS).map(offer => `| ${offer.tier === "founding_individual" ? "Founding individual" : offer.tier === "couple" ? "Couples" : "Individual"}, ${offer.plan} | ${formatMembershipPrice(offer.amount)}${future ? ` on ${future}` : " at checkout"} | ${formatMembershipPrice(offer.initialTermAmount)} | ${formatMembershipPrice(offer.amount)} ${offer.plan === "monthly" ? "monthly" : "annually"} |`).join("\n"),
  } } : onboarding;
  const status = commitment?.status;
  const reviewingCanceledOffer = reviewAgain && enabled && status === "canceled" && commitment?.canceledBeforeStart === true && (!commitment.billingSchedule || commitment.refundStatus === "succeeded");
  const commitmentEnd = commitment ? longDate(commitment.initialTermEndsAt) : null;

  useEffect(() => {
    if (!completingRegistration || preview || reviewAgain || confirmationNavigation.current ||
      (!returnedFromCheckout && status !== "scheduled" && status !== "active")) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    setConfirmationSlow(false);
    async function checkRegistration() {
      attempts++;
      try {
        const response = await fetch("/api/my/registration/status", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (response.ok && result.paymentConfirmed === true && !controller.signal.aborted) {
          confirmationNavigation.current = true;
          window.location.replace("/my/registered");
          return;
        }
      } catch { /* A delayed webhook or read failure must never claim success. */ }
      if (controller.signal.aborted) return;
      if (attempts < 20) timer = setTimeout(checkRegistration, 1500);
      else setConfirmationSlow(true);
    }
    void checkRegistration();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [completingRegistration, preview, reviewAgain, returnedFromCheckout, status, refresh]);

  return <div className="mt-7">
    {preview ? <p className="mb-6 border-l-2 border-[var(--member-red)] pl-3 text-sm" role="status">Preview only. No agreement is accepted and no billing is authorized.</p> : null}
    {loading ? <p className="py-6 text-sm" role="status">Checking your membership billing…</p> : loadError ? <section className="border-t border-[var(--member-rule)] py-6" role="alert">
      <p>{loadError}</p><button className={linkClass + " mt-3"} type="button" onClick={refreshStatus}>Check billing again</button>
      <p className="mt-2 text-sm text-[var(--member-muted)]">Contact Ruined if you need help before a scheduled payment.</p>
    </section> : commitment && !reviewingCanceledOffer ? <section className="border-t border-[var(--member-rule)] pt-6" aria-label="Membership billing status">
      <h2 className="text-2xl font-semibold">{status === "refund_pending" ? "Your refund is being confirmed." : status === "scheduled" ? commitment.billingSchedule ? "Your first period is paid." : "Your first payment is scheduled." : status === "canceled" ? commitment.canceledBeforeStart ? "Scheduled membership canceled." : "Membership billing canceled." : status === "review_required" ? "Billing needs review." : status === "pending_payment" ? commitment.billingSchedule ? "Membership confirmation pending." : "Your first payment is pending." : "Membership billing confirmed."}</h2>
      {commitmentEnd && status !== "canceled" && status !== "review_required" && status !== "refund_pending" ? <p className="mt-3 text-sm text-[var(--member-muted)]">{commitment.billingSchedule ? `Initial commitment ends ${scheduleDate(commitment.billingSchedule.initialTermEndsAt)}.` : `Initial commitment ends at the start of ${commitmentEnd}, Mountain Time.`}</p> : null}
      {status === "scheduled" && commitment.startsAt ? <>
        {commitment.billingSchedule ? <>
          <p className="mt-5 text-xl font-semibold">Service begins {scheduleDate(commitment.billingSchedule.serviceStartsAt)}.</p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">Your initial payment is confirmed. Next charge: {formatMembershipPrice(commitment.installmentDues ?? 0)}, plus applicable tax, on {scheduleDate(commitment.billingSchedule.nextChargeAt)}. {commitment.plan === "monthly" ? "Eleven further monthly installments complete your initial 12-month commitment, followed by monthly renewals." : "Your first year is paid upfront, followed by annual renewals."} Your profile opens separately when Ruined releases it.</p>
          <p className="mt-3 text-sm text-[var(--member-muted)]">Your cohort’s signup cutoff: {scheduleDate(commitment.billingSchedule.cutoffAt)}.</p>
          <h3 className="mt-5 font-semibold">Your first four Foundations calls</h3>
          <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{commitment.billingSchedule.callStartsAt.map((call, index) => <li key={call}>{index + 1}. <time dateTime={call}>{new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Denver" }).format(new Date(call))}, {scheduleDate(call)}</time></li>)}</ol>
        </> : <><p className="mt-5 text-3xl font-semibold tracking-[-0.03em]">{formatMembershipPrice(commitment.installmentDues ?? 0)} <span className="text-lg font-normal">on {longDate(commitment.startsAt)}</span></p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">Plus applicable tax. Nothing is charged before this date. Your initial 12-month term begins then{commitment.plan === "monthly" ? ", with 12 monthly installments and monthly renewals afterward." : ", paid upfront, with annual renewals afterward."} Your profile opens separately when Ruined releases it.</p></>}
        {preview ? <div className="mt-6 border-t border-[var(--member-rule)] pt-5"><p className="text-sm">{commitment.billingSchedule ? "Cancel before service begins for a full refund of your initial payment, including tax." : "Cancel before the first charge with no fee."}</p><button className="mt-4 min-h-11 border border-current px-5 text-sm disabled:opacity-50" type="button" disabled>{commitment.billingSchedule ? "Review cancellation and refund" : "Cancel before first charge"}</button></div>
          : <MembershipCancellation key={commitment.startsAt} initialCommitment={commitment} onCanceled={refreshStatus} />}
      </> : status === "canceled" ? <>
        <p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">{commitment.canceledBeforeStart ? commitment.billingSchedule && commitment.refundStatus === "succeeded" ? "Your initial payment has been refunded. No membership payment is scheduled. Your registration and any reserved founding eligibility remain saved. A new membership requires another review and confirmation." : "No membership payment is scheduled. Your registration remains saved. A new membership requires another review and confirmation." : "This subscription is canceled. Contact Ruined about any existing invoice or a new membership."}</p>
        {commitment.canceledBeforeStart && (!commitment.billingSchedule || commitment.refundStatus === "succeeded") && (enabled || preview) ? <button className="mt-5 min-h-12 border border-current px-5 text-sm font-semibold disabled:opacity-50" type="button" disabled={!enabled || preview} onClick={() => { if (enabled && !preview) setReviewAgain(true); }}>Review membership again</button> : null}
      </>
        : status === "refund_pending" ? <><p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">Your cancellation and refund are still being confirmed. Wait for the confirmed result before starting another membership.</p>{!preview ? <MembershipCancellation initialCommitment={commitment} onCanceled={refreshStatus} /> : null}</>
        : status === "review_required" ? <p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">Contact Ruined to resolve your billing before confirming another membership.</p>
          : status === "pending_payment" ? <><p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">{commitment.billingSchedule ? "We are confirming payment and the start of service. Your receipt will update when both are confirmed. Contact Ruined if you need help." : "A paid first invoice has not yet been confirmed. Contact Ruined if your payment needs attention."}</p><button className={linkClass + " mt-3"} type="button" onClick={refreshStatus}>Check payment status</button></>
          : <><p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">Manage renewal or review cancellation below. Profile access remains separate from billing.</p>{!preview ? <MembershipCancellation initialCommitment={commitment} onCanceled={refreshStatus} /> : null}</>}
      {completingRegistration && commitment.billingSchedule && ["scheduled", "active"].includes(status ?? "") ? <p className="mt-6 text-sm" role="status">Opening your registration confirmation…</p> : null}
    </section> : returnedFromCheckout && !preview && !reviewingCanceledOffer ? <section className="border-t border-[var(--member-rule)] py-6" aria-live="polite">
      <h2 className="text-2xl font-semibold">Waiting for Stripe confirmation.</h2>
      <p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">Your confirmation has not reached this account yet. Check again in a moment before starting another checkout.</p>
      <button className={linkClass + " mt-4"} type="button" onClick={refreshStatus}>Check confirmation</button>
    </section> : <>
      <p className="max-w-xl text-sm leading-relaxed text-[var(--member-muted)]">{billingSchedule ? "Pay your first period when you confirm. Service and your initial 12-month commitment begin with your cohort’s first Foundations call. Your offer shows the exact dates before you authorize payment." : future ? `Confirm ahead of time. Your first charge is ${future}, and nothing is charged today.` : "Review your exact membership offer and payment terms before confirming checkout."}{completingRegistration ? null : " Your registration and saved card alone do not authorize billing."}</p>
      {disabledReason && !preview ? <p className="mt-5 border-l-2 border-[var(--member-red)] pl-3 text-sm" role="status">{disabledReason}</p> : null}
      {enabled || preview ? <JoinForm
        activationOnly
        checkoutDisabledReason={preview ? "Preview only. Checkout is disabled." : null}
        checkoutEnabled={enabled || preview}
        disabledReason={preview ? "Preview only. Agreement acceptance is disabled." : null}
        enabled={enabled}
        initialOnboarding={previewOnboarding}
        initialPlan={initialPlan}
        minimumAge={minimumAge}
        photoStorageReady={false}
        publishableKey={publishableKey}
        preview={preview}
        streamlinedPayment={completingRegistration}
        initialQuote={preview && previewView !== "agreement" ? { id: "preview-offer", expiresAt: "2026-10-31T23:00:00Z", offer: MEMBERSHIP_OFFERS[initialPlan === "annual" ? "founding_individual_annual" : "founding_individual_monthly"],
          billingTermsVersion: "membership-billing-v2", buyoutCap: 150000, participants: [{ memberId: "preview-member", name: "Preview Member" }], firstChargeAt: billingSchedule ? null : firstChargeAt, ...(billingSchedule ? { billingSchedule, expiresAt: billingSchedule.cutoffAt } : {}) } : null}
      /> : null}
    </>}
    {confirmationSlow ? <p className="mt-5 text-sm" role="status">Confirmation is taking a little longer. Your payment will not be repeated. <button type="button" className={linkClass} onClick={refreshStatus}>Check confirmation again</button></p> : null}
    <nav className="mt-10 flex flex-wrap gap-x-7 border-t border-[var(--member-rule)] pt-5" aria-label="Registration and support">
      {!completingRegistration ? <><Link className={linkClass} href="/my/registered">Your registration</Link>
      <Link className={linkClass} href="/my/payment-method">Manage saved card</Link></> : null}
      <a className={linkClass} href="mailto:connect@theruinedproject.com">Contact Ruined</a>
    </nav>
  </div>;
}
