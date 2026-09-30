"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { PAYMENT_SETUP_CONSENT_TEXT, type MemberPaymentMethodStatus } from "@/lib/stripe/payment-method-model";

type SetupState = "not_saved" | "pending" | "saved";
type PaymentMethodSnapshot = MemberPaymentMethodStatus;
type Props = {
  preview?: boolean;
  registrationOnly?: boolean;
  initialPreviewState?: SetupState;
  returnState?: "returned" | "cancelled" | null;
};
const actionClass = "inline-flex min-h-12 items-center justify-center rounded-[4px] bg-[var(--member-ink)] px-5 py-3 text-sm font-semibold text-[var(--member-paper)] focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-40";
const linkClass = "inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-40";

function previewSnapshot(state: SetupState): PaymentMethodSnapshot {
  return { enabled: true, eligible: true, reason: null, state, canRemove: state === "saved", removalPending: false,
    paymentMethod: state === "saved" ? { type: "card", label: "Visa ending in 4242", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 } : null };
}

/** Setup-only consent. A returned browser URL never means Stripe has confirmed it. */
export default function MemberPaymentMethod({ preview = false, initialPreviewState = "not_saved", returnState = null, registrationOnly = false }: Props) {
  const titleId = useId();
  const attemptRef = useRef<string | null>(null);
  const receiptNavigationRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const [snapshot, setSnapshot] = useState<PaymentMethodSnapshot | null>(() => preview ? previewSnapshot(initialPreviewState) : null);
  const [loading, setLoading] = useState(!preview);
  const [refreshKey, setRefreshKey] = useState(0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    fetch("/api/stripe/payment-method", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Your payment method could not be checked.");
        if (!controller.signal.aborted) {
          if (result.state === "not_saved" && !result.removalPending) {
            // An expired/revoked attempt must not pin this page to an unusable
            // idempotency key. Only an authoritative read clears it.
            attemptRef.current = null;
            setConsent(false);
          }
          setSnapshot(result);
        }
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Your payment method could not be checked."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [preview, refreshKey]);

  useEffect(() => {
    if (!registrationOnly || preview || returnState !== "returned" || loading || busy || snapshot?.state !== "saved" || receiptNavigationRef.current) return;
    receiptNavigationRef.current = true;
    // Only a provider-confirmed saved method advances the browser; the receipt
    // performs a fresh registration/readiness check before showing completion.
    window.location.assign("/my/registered");
  }, [registrationOnly, preview, returnState, loading, busy, snapshot?.state]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!confirmRemove || !dialog) return;
    const returnFocus = removeButtonRef.current;
    dialog.showModal();
    keepButtonRef.current?.focus();
    return () => { dialog.close(); returnFocus?.focus(); };
  }, [confirmRemove]);

  function refresh() {
    if (preview || busy) return;
    setError(null);
    setLoading(true);
    setRefreshKey(value => value + 1);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || busy || loading || !consent || !snapshot?.enabled || !snapshot.eligible) return;
    setBusy("save"); setError(null); setRemoved(false);
    try {
      attemptRef.current ??= crypto.randomUUID();
      const response = await fetch("/api/stripe/payment-method", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: attemptRef.current, consentAccepted: true, consentVersion: "save-payment-method-v1" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Secure payment-method setup is unavailable. Please try again.");
      const destination = new URL(result.url);
      if (destination.protocol !== "https:" || destination.hostname !== "checkout.stripe.com" || destination.username || destination.password) {
        throw new Error("Secure payment-method setup could not be opened. Please try again.");
      }
      window.location.assign(destination.href);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Secure payment-method setup could not be opened.");
      setBusy(null);
    }
  }

  async function remove() {
    if (preview || busy || loading || !confirmRemove || !snapshot?.canRemove) return;
    setBusy("remove"); setRemoveError(null);
    try {
      const response = await fetch("/api/stripe/payment-method", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your saved payment method could not be removed.");
      setSnapshot(result);
      setConsent(false); setRemoved(true); setConfirmRemove(false); setError(null);
      attemptRef.current = null;
    } catch (failure) {
      setRemoveError(failure instanceof Error ? failure.message : "Your saved payment method could not be removed.");
      // A failed provider detach may still have withdrawn storage consent.
      // Re-read the committed state instead of keeping a stale "saved" claim.
      setLoading(true); setRefreshKey(value => value + 1);
    } finally { setBusy(null); }
  }

  const saved = snapshot?.state === "saved";
  const pending = snapshot?.state === "pending";
  const available = Boolean(snapshot?.enabled && snapshot.eligible);
  const method = snapshot?.paymentMethod;

  return <section aria-labelledby={titleId} className="min-w-0 rounded-[4px] border border-[var(--member-rule)] bg-[var(--member-soft)] p-5 sm:p-7" data-payment-method-panel>
    {preview ? <fieldset className="mb-6 flex min-w-0 flex-wrap gap-x-4 gap-y-1 border-0 p-0">
      <legend className="mb-1 text-xs text-[var(--member-muted)]">Preview state · no live actions</legend>
      {([ ["not_saved", "Setup"], ["pending", "Confirming"], ["saved", "Saved"] ] as const).map(([value,label]) => <button key={value} type="button" className={linkClass} aria-pressed={snapshot?.state === value} onClick={() => { setSnapshot(previewSnapshot(value)); setConsent(false); }}>{label}</button>)}
    </fieldset> : null}
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--member-red)]">{registrationOnly ? "Registration / Save your card" : "Before we begin / Optional"}</p>
    <h2 id={titleId} className="mt-3 font-[var(--font-display)] text-[clamp(1.9rem,7vw,2.8rem)] leading-tight tracking-[-0.025em]">Get ready for Ruined.</h2>
    <p className="mt-4 text-base leading-relaxed">Securely save your payment method.</p>
    <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--member-muted)]">You won’t be charged today. We’ll ask you to confirm before membership begins.</p>

    {loading ? <p className="mt-6 text-sm" role="status">Checking your payment method…</p> : null}
    {!loading && saved ? <div className="mt-6" role="status">
      <p className="font-semibold">Payment method saved{snapshot?.eligible ? <> <span aria-hidden="true">·</span> Awaiting launch</> : null}</p>
      {method ? <div className="mt-4 flex min-w-0 items-center gap-3 rounded-[4px] border border-[var(--member-rule)] p-4">
        <svg className="size-7 shrink-0" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></svg>
        <div className="min-w-0"><p className="break-words text-sm font-medium">{method.label}</p>{method.expMonth && method.expYear ? <p className="mt-1 text-xs text-[var(--member-muted)]">Expires {String(method.expMonth).padStart(2,"0")}/{method.expYear}</p> : null}</div>
      </div> : null}
      <p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">Saving a payment method doesn’t charge you or start a membership. Your payment details are stored securely by Stripe.</p>
      {!snapshot?.eligible && snapshot?.reason ? <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">{snapshot.reason}</p> : null}
      {snapshot?.canRemove ? <button className={linkClass + " mt-3"} ref={removeButtonRef} type="button" disabled={preview || Boolean(busy)} onClick={() => { setRemoveError(null); setConfirmRemove(true); }}>Remove saved payment method</button> : null}
    </div> : null}
    {!loading && pending ? <div className="mt-6 border-l-2 border-[var(--member-red)] pl-4" role="status">
      <p className="font-semibold">{snapshot?.removalPending ? "Finishing removal." : "Waiting for Stripe confirmation."}</p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--member-muted)]">{snapshot?.removalPending ? "Your permission to save this method has been withdrawn. Stripe hasn’t finished removing it yet. Retry removal to finish." : "Your payment method isn’t confirmed yet. If you finished on Stripe, give it a moment and check again. You won’t be charged."}</p>
      <button className={linkClass + " mt-2"} type="button" onClick={refresh} disabled={preview || Boolean(busy)}>Check again</button>
      {snapshot?.canRemove ? <button className={linkClass + " ml-5 mt-2"} ref={removeButtonRef} type="button" disabled={preview || Boolean(busy)} onClick={() => { setRemoveError(null); setConfirmRemove(true); }}>{snapshot.removalPending ? "Retry removal" : "Cancel payment-method setup"}</button> : null}
    </div> : null}
    {!loading && !saved && returnState === "cancelled" ? <p className="mt-5 text-sm leading-relaxed" role="status">You left setup before finishing. No payment was taken. {registrationOnly ? "Save your card to finish registration." : "Saving a payment method is optional."}</p> : null}
    {!loading && snapshot?.state === "not_saved" && returnState === "returned" && !removed ? <div className="mt-5 text-sm leading-relaxed" role="status"><p>We haven’t received confirmation from Stripe yet. If you finished setup, check again in a moment.</p><button className={linkClass} type="button" onClick={refresh} disabled={preview || Boolean(busy)}>Check again</button></div> : null}
    {!loading && !saved && available ? <form className="mt-6" onSubmit={save}>
      <label className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-3 text-sm leading-relaxed">
        <input className="mt-1 size-4 accent-[var(--member-red)]" name="save-payment-method-consent" type="checkbox" checked={consent} disabled={Boolean(busy)} required onChange={event => setConsent(event.target.checked)} />
        <span>{PAYMENT_SETUP_CONSENT_TEXT}</span>
      </label>
      <button className={actionClass + " mt-5 w-full sm:w-auto"} disabled={preview || !consent || Boolean(busy)} type="submit">{busy === "save" ? "Opening Stripe…" : pending ? "Resume secure setup" : "Save payment method securely"}</button>
      <p className="mt-3 text-xs leading-relaxed text-[var(--member-muted)]">You’ll continue to Stripe. You can remove an unused saved payment method before joining.</p>
    </form> : null}
    {!loading && snapshot && !available && !saved ? <p className="mt-6 text-sm leading-relaxed" role="status">{snapshot.reason || "Payment-method setup isn’t available right now. You can return later."}</p> : null}
    {removed ? <p className="mt-5 text-sm" role="status">{registrationOnly ? "Saved payment method removed. Save a card again to finish registration." : "Saved payment method removed. Your profile is still here."}</p> : null}
    {error ? <div className="mt-5 text-sm leading-relaxed" role="alert"><p>{error}</p><div className="mt-2 flex flex-wrap gap-x-5"><button className={linkClass} type="button" onClick={refresh} disabled={Boolean(busy) || loading}>Check payment-method status</button><Link className={linkClass} href={registrationOnly ? "mailto:connect@theruinedproject.com" : "/my/support"}>Get help</Link></div></div> : null}
    {preview ? <p className="mt-4 text-xs text-[var(--member-muted)]">Preview only. Example card details; no payment methods are saved or removed.</p> : null}
    <div className="mt-6 border-t border-[var(--member-rule)] pt-3">
      {registrationOnly ? <>
        {!loading && saved ? <Link className={actionClass + " mt-2"} href="/my/registered">{preview ? "Preview registration receipt" : "Continue to registration receipt"}</Link> : <p className="text-sm leading-relaxed text-[var(--member-muted)]">Your details are saved. Card setup is the last step in registration.</p>}
        <p className="mt-3 text-xs leading-relaxed text-[var(--member-muted)]">Registration does not open member access. We’ll email you when your profile is ready.</p>
      </> : <><Link className={linkClass} href="/my/account">{saved ? "Back to my account" : "Do this later"}</Link><p className="text-xs leading-relaxed text-[var(--member-muted)]">Your profile and waitlist place don’t depend on saving a payment method.</p></>}
    </div>

    <dialog ref={dialogRef} aria-labelledby={`${titleId}-remove`} aria-describedby={`${titleId}-remove-copy`} onCancel={event => { event.preventDefault(); if (!busy) setConfirmRemove(false); }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-[4px] border border-[var(--member-rule)] bg-[var(--member-paper)] p-5 text-[var(--member-ink)] shadow-2xl backdrop:bg-black/70 sm:p-7">
      <h3 id={`${titleId}-remove`} className="text-xl font-semibold">{snapshot?.removalPending ? "Finish removing payment method?" : pending ? "Cancel payment-method setup?" : "Remove saved payment method?"}</h3>
      <p id={`${titleId}-remove-copy`} className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">Your permission to save a method will be withdrawn and any unused saved payment method will be removed from Ruined. {registrationOnly ? "You’ll need to save a card again to complete registration. Your personal details stay saved." : "Your profile and waitlist place stay unchanged. You can save a payment method again later."}</p>
      {removeError ? <p className="mt-4 text-sm" role="alert">{removeError}</p> : null}
      <div className="mt-5 flex flex-wrap gap-3"><button className={actionClass} ref={keepButtonRef} disabled={Boolean(busy)} type="button" onClick={() => setConfirmRemove(false)}>{snapshot?.removalPending ? "Close" : pending ? "Keep setup" : "Keep payment method"}</button><button className={linkClass} disabled={Boolean(busy) || loading} type="button" onClick={remove}>{busy === "remove" ? "Removing…" : "Remove payment method"}</button></div>
    </dialog>
  </section>;
}
