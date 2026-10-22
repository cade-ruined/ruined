"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { OPERATOR_BUTTON_CLASS } from "@/components/platform/operatorStyles";
import {
  OPERATOR_PAYMENT_SETUP_CONSENT_TEXT,
  OPERATOR_PAYMENT_SETUP_CONSENT_VERSION,
  type MemberPaymentMethodStatus,
} from "@/lib/stripe/payment-method-model";

const previewStatus: MemberPaymentMethodStatus = {
  enabled: true, eligible: true, canRemove: false, removalPending: false,
  reason: null, state: "not_saved", paymentMethod: null,
};

function operatorReason(reason: string) {
  return reason.replace(/\bYour\b/g, "This member’s").replace(/\byour\b/g, "this member’s").replace(/\bYou\b/g, "This member");
}

export default function OperatorMemberPaymentMethod({ memberId, memberName, preview = false }: {
  memberId: string; memberName: string; preview?: boolean;
}) {
  const router = useRouter();
  const attempt = useRef<string | null>(null);
  const refreshed = useRef(false);
  const [status, setStatus] = useState<MemberPaymentMethodStatus | null>(preview ? previewStatus : null);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(!preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [returned, setReturned] = useState<string | null>(null);
  const endpoint = `/api/ops/members/${encodeURIComponent(memberId)}/payment-method`;

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checks = 0;
    const returnState = new URL(window.location.href).searchParams.get("paymentSetup");
    setReturned(returnState);
    setLoading(true);
    setError(null);
    async function check() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The saved card could not be checked.");
        if (!["not_saved", "pending", "saved"].includes(result.state)) throw new Error("The saved card could not be checked.");
        if (controller.signal.aborted) return;
        setStatus(result);
        setLoading(false);
        if (result.state === "not_saved" && !result.removalPending) {
          attempt.current = null;
          setConsent(false);
        }
        if (result.state === "saved") {
          if (returnState === "returned" && !refreshed.current) {
            refreshed.current = true;
            router.refresh();
          }
        } else if (returnState !== "cancelled" && !result.removalPending && ++checks < 10 && (result.state === "pending" || returnState === "returned")) {
          timer = setTimeout(check, 2000);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setStatus(null);
          setError(failure instanceof Error ? failure.message : "The saved card could not be checked.");
          setLoading(false);
        }
      }
    }
    void check();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [endpoint, preview, refreshKey, router]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || busy || loading || !consent || !status?.enabled || !status.eligible || status.state === "saved") return;
    setBusy(true);
    setError(null);
    try {
      attempt.current ??= crypto.randomUUID();
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: attempt.current, consentAccepted: true, consentVersion: OPERATOR_PAYMENT_SETUP_CONSENT_VERSION }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Secure card setup is unavailable. Please try again.");
      const destination = new URL(result.url);
      if (destination.protocol !== "https:" || destination.hostname !== "checkout.stripe.com" || destination.username || destination.password) {
        throw new Error("Secure card setup could not be opened. Please try again.");
      }
      window.location.assign(destination.href);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Secure card setup could not be opened.");
      setBusy(false);
    }
  }

  const saved = status?.state === "saved";
  const canSave = status?.enabled && status.eligible && !saved && !status.removalPending;
  return <section className="operator-glass mt-4 rounded-none p-4" aria-label={`Saved card for ${memberName}`}>
    <h4 className="ui-heading text-sm font-semibold">{saved ? "Saved payment method" : "Save a card for later (optional)"}</h4>
    <p className="mt-2 text-sm leading-relaxed text-[color:var(--operator-muted)]">Save a card for {memberName} without starting checkout. No charge is made here. To accept the agreement and pay now, use Complete membership above.</p>
    {preview ? <p className="mt-2 text-xs text-[color:var(--operator-muted)]">Preview only. No card is saved or charged.</p> : null}
    {loading ? <p className="mt-3 text-sm" role="status">Checking saved payment method…</p> : saved ? <div className="mt-3 text-sm" role="status">
      <p className="font-semibold">{status.paymentMethod?.label ?? "Payment method saved"}</p>
      <p className="mt-1 text-[color:var(--operator-muted)]">Saved for {memberName}. Saving a card does not confirm payment or open their profile.</p>
    </div> : status?.removalPending ? <p className="mt-3 text-sm" role="status">Payment method removal is still being confirmed.</p> : returned === "cancelled" ? <p className="mt-3 text-sm" role="status">Card setup was not completed. No charge was made.</p> : status?.state === "pending" || returned === "returned" ? <p className="mt-3 text-sm" role="status">Waiting for Stripe confirmation. A card is only shown as saved after Stripe confirms it.</p> : null}
    {!loading && status?.reason ? <p className="mt-3 text-sm text-[color:var(--operator-muted)]">{operatorReason(status.reason)}</p> : null}
    {!loading && canSave ? <form className="mt-4" onSubmit={save}>
      <label className="flex items-start gap-3 text-sm leading-relaxed">
        <input className="mt-1 h-5 w-5 shrink-0 accent-[var(--operator-ink)]" type="checkbox" name="operator-save-card-consent" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
        <span>{OPERATOR_PAYMENT_SETUP_CONSENT_TEXT}</span>
      </label>
      <button className={`${OPERATOR_BUTTON_CLASS} mt-4`} type="submit" disabled={preview || busy || !consent}>
        {busy ? "Opening Stripe…" : status.state === "pending" ? "Continue secure card setup" : "Add card securely"}
      </button>
    </form> : null}
    {error ? <p className="mt-3 text-sm text-[var(--operator-danger)]" role="alert">{error}</p> : null}
    {!preview && !busy ? <button className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4 disabled:opacity-50" type="button" disabled={loading} onClick={() => setRefreshKey(value => value + 1)}>Check saved card status</button> : null}
  </section>;
}
