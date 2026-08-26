"use client";

import Link from "next/link";
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

import type { MemberOnboardingSnapshot } from "@/lib/membership/model";

type CheckoutResponse = {
  clientSecret?: string;
  error?: string;
};

type AgreementResponse = {
  acceptance?: { id: string };
  error?: string;
  onboarding?: MemberOnboardingSnapshot;
};

type OnboardingResponse = {
  error?: string;
  onboarding?: MemberOnboardingSnapshot;
};

const stripeClients = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string): Promise<Stripe | null> {
  const existing = stripeClients.get(publishableKey);
  if (existing) return existing;
  const client = loadStripe(publishableKey);
  stripeClients.set(publishableKey, client);
  return client;
}

function EmbeddedCheckout({
  clientSecret,
  publishableKey,
  setError,
}: {
  clientSecret: string;
  publishableKey: string;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let checkout: Awaited<ReturnType<Stripe["createEmbeddedCheckoutPage"]>> | null = null;

    async function mountCheckout() {
      const stripe = await stripeFor(publishableKey);
      if (!stripe) throw new Error("Secure payment could not be loaded.");
      const instance = await stripe.createEmbeddedCheckoutPage({ clientSecret });
      if (cancelled) {
        instance.destroy();
        return;
      }
      checkout = instance;
      if (!mountRef.current) throw new Error("Secure payment could not be mounted.");
      instance.mount(mountRef.current);
    }

    mountCheckout().catch((checkoutError) => {
      if (!cancelled) {
        setError(
          checkoutError instanceof Error
            ? checkoutError.message
            : "Secure payment could not be loaded.",
        );
      }
    });
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [clientSecret, publishableKey, setError]);

  return (
    <div className="mt-8 min-h-[34rem] overflow-hidden bg-white" aria-label="Secure Stripe payment">
      <div ref={mountRef} />
    </div>
  );
}

const fieldClass =
  "mt-2 min-h-12 w-full border border-white/20 bg-transparent px-3 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-[var(--color-poster)]";

function savedString(value: Record<string, unknown> | null, key: string) {
  return value && typeof value[key] === "string" ? String(value[key]) : "";
}

function StageLine({ active, complete, label, number }: { active: boolean; complete: boolean; label: string; number: string }) {
  return (
    <li className={`border-t pt-3 ${active ? "border-[var(--color-poster)]" : "border-white/15"}`}>
      <span className="text-[0.58rem] uppercase tracking-[0.14em] text-white/35">{number}</span>
      <p className={`mt-2 text-xs uppercase tracking-[0.12em] ${active ? "text-white" : complete ? "text-white/58" : "text-white/30"}`}>
        {complete ? `${label} / Complete` : label}
      </p>
    </li>
  );
}

export default function JoinForm({
  disabledReason,
  checkoutDisabledReason,
  checkoutEnabled,
  enabled,
  initialOnboarding,
  minimumAge,
  publishableKey,
}: {
  disabledReason: string | null;
  checkoutDisabledReason: string | null;
  checkoutEnabled: boolean;
  enabled: boolean;
  initialOnboarding: MemberOnboardingSnapshot;
  minimumAge: number;
  publishableKey: string | null;
}) {
  const checkoutAttempt = useRef<string | null>(null);
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [acceptanceId, setAcceptanceId] = useState(initialOnboarding.agreement.acceptanceId);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const profileComplete = onboarding.requiredFieldsComplete;
  const agreementComplete = Boolean(acceptanceId);
  const stage = !profileComplete ? "profile" : !agreementComplete ? "agreement" : "payment";
  const address = onboarding.profile.fulfillmentAddress;
  const sizing = onboarding.profile.apparelSizing;

  function attemptId() {
    checkoutAttempt.current ??= crypto.randomUUID();
    return checkoutAttempt.current;
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || submitting) return;
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/my/onboarding", {
        body: JSON.stringify({
          action: "save_profile",
          apparelTopSize: String(form.get("apparel-size") ?? ""),
          birthDate: String(form.get("birth-date") ?? ""),
          legalName: String(form.get("legal-name") ?? ""),
          mobile: String(form.get("mobile") ?? ""),
          preferredName: String(form.get("preferred-name") ?? ""),
          shippingAddress: {
            addressLine1: String(form.get("address-line-1") ?? ""),
            addressLine2: String(form.get("address-line-2") ?? "").trim() || null,
            city: String(form.get("city") ?? ""),
            countryCode: String(form.get("country-code") ?? ""),
            postalCode: String(form.get("postal-code") ?? ""),
            region: String(form.get("region") ?? ""),
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as OnboardingResponse;
      if (!response.ok || !payload.onboarding) {
        throw new Error(payload.error || "Your member profile could not be saved.");
      }
      setOnboarding(payload.onboarding);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Your member profile could not be saved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptAgreement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || submitting || !onboarding.agreement.id) return;
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/my/agreement", {
        body: JSON.stringify({
          affirmativeAction: "checkbox_and_submit",
          ageConfirmed: form.get("age-confirmed") === "on",
          agreementVersionId: onboarding.agreement.id,
          attemptId: attemptId(),
          signerName: String(form.get("signer-name") ?? ""),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as AgreementResponse;
      if (!response.ok || !payload.acceptance?.id || !payload.onboarding) {
        throw new Error(payload.error || "The agreement could not be recorded.");
      }
      setAcceptanceId(payload.acceptance.id);
      setOnboarding(payload.onboarding);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The agreement could not be recorded.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function openCheckout() {
    if (!checkoutEnabled || !publishableKey || !acceptanceId || submitting || clientSecret) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/stripe/checkout", {
        body: JSON.stringify({
          acceptanceId,
          attemptId: attemptId(),
        }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as CheckoutResponse;
      if (!response.ok || !payload.clientSecret) {
        throw new Error(payload.error || "Secure payment is temporarily unavailable.");
      }
      setClientSecret(payload.clientSecret);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Secure payment is temporarily unavailable.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-10">
      <ol className="grid grid-cols-3 gap-3">
        <StageLine active={stage === "profile"} complete={profileComplete} label="Profile" number="01" />
        <StageLine active={stage === "agreement"} complete={agreementComplete} label="Agreement" number="02" />
        <StageLine active={stage === "payment"} complete={Boolean(clientSecret)} label="Payment" number="03" />
      </ol>

      {stage === "profile" ? (
        <form className="mt-9 grid gap-6" onSubmit={saveProfile}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">First / Who you are</p>
            <h3 className="mt-4 font-[var(--font-display)] text-4xl tracking-[-0.03em]">Administrative profile</h3>
            <p className="mt-4 text-sm leading-relaxed text-white/52">These details hold access, age verification, and physical fulfillment. They are never shown on the Circle roster.</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">Legal name<input className={fieldClass} defaultValue={onboarding.profile.legalName ?? ""} maxLength={180} name="legal-name" required /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">Preferred name<input className={fieldClass} defaultValue={onboarding.profile.preferredName ?? ""} maxLength={120} name="preferred-name" required /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">Confirmed email<input className={`${fieldClass} text-white/45`} disabled value={onboarding.email} /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">Mobile / include country code<input className={fieldClass} defaultValue={onboarding.profile.mobile ?? ""} inputMode="tel" name="mobile" placeholder="+18015550100" required /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">Birth date<input className={fieldClass} defaultValue={onboarding.profile.birthDate ?? ""} name="birth-date" required type="date" /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">Apparel top size<select className={fieldClass} defaultValue={savedString(sizing, "top")} name="apparel-size" required><option className="text-black" value="">Choose</option>{["XS", "S", "M", "L", "XL", "2XL", "3XL"].map((size) => <option className="text-black" key={size} value={size}>{size}</option>)}</select></label>
          </div>

          <fieldset className="grid gap-5 border-t border-white/15 pt-6 sm:grid-cols-2">
            <legend className="mb-5 text-xs font-semibold uppercase tracking-[0.16em] text-white/48">Default shipping address</legend>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50 sm:col-span-2">Address<input className={fieldClass} defaultValue={savedString(address, "addressLine1")} name="address-line-1" required /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50 sm:col-span-2">Address line 2 / optional<input className={fieldClass} defaultValue={savedString(address, "addressLine2")} name="address-line-2" /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">City<input className={fieldClass} defaultValue={savedString(address, "city")} name="city" required /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">State or region<input className={fieldClass} defaultValue={savedString(address, "region")} name="region" required /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">Postal code<input className={fieldClass} defaultValue={savedString(address, "postalCode")} name="postal-code" required /></label>
            <label className="text-xs uppercase tracking-[0.12em] text-white/50">Country code<input className={fieldClass} defaultValue={savedString(address, "countryCode") || "US"} maxLength={2} name="country-code" required /></label>
          </fieldset>

          <div className="border border-white/15 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-white/45">Member portrait / Optional now</p>
            <div className="mt-4 aspect-[16/5] border border-dashed border-white/20 bg-white/[0.025] p-4">
              <p className="font-[var(--font-handwritten)] text-lg text-[var(--color-poster)]">portrait placeholder</p>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-white/38">Your portrait remains visibly incomplete until private member-photo storage is connected. It does not block entry.</p>
            </div>
          </div>

          {error || disabledReason ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">{error ?? disabledReason}</p> : null}
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || submitting} type="submit">{submitting ? "Saving profile" : "Save & review agreement"}</button>
        </form>
      ) : null}

      {stage === "agreement" ? (
        <form className="mt-9 grid gap-6" onSubmit={acceptAgreement}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">Second / Exact agreement</p>
            <h3 className="mt-4 font-[var(--font-display)] text-4xl tracking-[-0.03em]">{onboarding.agreement.title ?? "Agreement not published"}</h3>
            {onboarding.agreement.version ? <p className="mt-3 text-xs uppercase tracking-[0.13em] text-white/38">Version {onboarding.agreement.version}</p> : null}
          </div>
          {onboarding.agreement.body && onboarding.agreement.id ? (
            <div className="max-h-[26rem] overflow-y-auto border border-white/18 bg-white/[0.025] p-5 sm:p-7" tabIndex={0}>
              <p className="whitespace-pre-wrap font-[var(--font-body)] text-sm leading-7 text-white/68">{onboarding.agreement.body}</p>
            </div>
          ) : (
            <p className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/68">Ruined has not published the membership agreement yet. Entry remains closed until the approved copy is available.</p>
          )}
          <label className="text-xs uppercase tracking-[0.12em] text-white/50">Type your saved legal name<input className={fieldClass} name="signer-name" required /></label>
          <div className="grid gap-4 text-sm leading-relaxed text-white/68">
            <label className="grid grid-cols-[1rem_1fr] items-start gap-3"><input className="mt-1 size-4 accent-[var(--color-poster)]" name="age-confirmed" required type="checkbox" /><span>I confirm that I am at least {minimumAge} years old.</span></label>
            <label className="grid grid-cols-[1rem_1fr] items-start gap-3"><input className="mt-1 size-4 accent-[var(--color-poster)]" name="agreement-accepted" required type="checkbox" /><span>I have read and accept this exact published Ruined Membership Agreement. A durable receipt will be kept with my account.</span></label>
          </div>
          <p className="text-xs leading-relaxed text-white/38">Ruined’s separate <Link className="underline underline-offset-4" href="/privacy">privacy policy</Link> explains how personal information is handled.</p>
          {error || disabledReason ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">{error ?? disabledReason}</p> : null}
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || !onboarding.agreement.id || !onboarding.agreement.body || submitting} type="submit">{submitting ? "Recording acceptance" : "Accept & continue"}</button>
        </form>
      ) : null}

      {stage === "payment" ? (
        <section className="mt-9" aria-labelledby="secure-payment-title">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">Final / Secure payment</p>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
            <h3 className="font-[var(--font-display)] text-4xl" id="secure-payment-title">Membership payment</h3>
            <span className="text-sm text-white/48">{onboarding.email}</span>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-white/52">Your profile and agreement are saved. Payment is the final administrative threshold.</p>
          {error || checkoutDisabledReason ? <p aria-live="polite" className="mt-6 border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">{error ?? checkoutDisabledReason}</p> : null}
          {!clientSecret ? (
            <button className="mt-7 min-h-12 w-full border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!checkoutEnabled || !publishableKey || submitting} onClick={openCheckout} type="button">{submitting ? "Preparing payment" : checkoutEnabled && publishableKey ? "Open secure payment" : "Payment not connected"}</button>
          ) : null}
          {clientSecret && publishableKey ? <EmbeddedCheckout clientSecret={clientSecret} publishableKey={publishableKey} setError={setError} /> : null}
          <p className="mt-4 text-xs leading-relaxed text-white/40">Payment is handled securely by Stripe. Store purchases remain separate.</p>
        </section>
      ) : null}
    </div>
  );
}
