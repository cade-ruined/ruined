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

type CheckoutResponse = {
  clientSecret?: string;
  error?: string;
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

export default function JoinForm({
  disabledReason,
  email,
  enabled,
  minimumAge,
  publishableKey,
}: {
  disabledReason: string | null;
  email: string;
  enabled: boolean;
  minimumAge: number;
  publishableKey: string | null;
}) {
  const checkoutAttempt = useRef<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || !publishableKey || submitting || clientSecret) return;

    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    checkoutAttempt.current ??= crypto.randomUUID();

    try {
      const response = await fetch("/api/stripe/checkout", {
        body: JSON.stringify({
          ageConfirmed: form.get("age-confirmed") === "on",
          agreementAccepted: form.get("agreement-accepted") === "on",
          attemptId: checkoutAttempt.current,
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

  if (clientSecret && publishableKey) {
    return (
      <section className="mt-10 border-t border-white/18 pt-8" aria-labelledby="secure-payment-title">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">
          Final step
        </p>
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
          <h3 className="font-[var(--font-display)] text-3xl" id="secure-payment-title">
            Secure payment
          </h3>
          <span className="text-sm text-white/48">{email}</span>
        </div>
        {error ? (
          <p aria-live="polite" className="mt-6 border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">
            {error}
          </p>
        ) : null}
        <EmbeddedCheckout
          clientSecret={clientSecret}
          publishableKey={publishableKey}
          setError={setError}
        />
        <p className="mt-4 text-xs leading-relaxed text-white/40">
          Payment is handled securely by Stripe. Store purchases remain separate.
        </p>
      </section>
    );
  }

  return (
    <form className="mt-10 grid gap-6" onSubmit={handleSubmit}>
      <div className="border-y border-white/15 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
          Confirmed member email
        </p>
        <p className="mt-3 text-sm text-white/72">{email}</p>
      </div>

      <div className="grid gap-4 text-sm leading-relaxed text-white/68">
        <label className="grid grid-cols-[1rem_1fr] items-start gap-3">
          <input
            className="mt-1 size-4 accent-[var(--color-poster)] disabled:opacity-35"
            disabled={!enabled || submitting}
            name="age-confirmed"
            required
            type="checkbox"
          />
          <span>I confirm that I am at least {minimumAge} years old.</span>
        </label>
        <label className="grid grid-cols-[1rem_1fr] items-start gap-3">
          <input
            className="mt-1 size-4 accent-[var(--color-poster)] disabled:opacity-35"
            disabled={!enabled || submitting}
            name="agreement-accepted"
            required
            type="checkbox"
          />
          <span>
            I accept the current{" "}
            <Link className="underline underline-offset-4" href="/terms">
              membership terms
            </Link>{" "}
            and{" "}
            <Link className="underline underline-offset-4" href="/privacy">
              privacy policy
            </Link>
            .
          </span>
        </label>
      </div>

      {error || disabledReason ? (
        <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">
          {error ?? disabledReason}
        </p>
      ) : null}

      <button
        className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50"
        disabled={!enabled || !publishableKey || submitting}
        type="submit"
      >
        {submitting
          ? "Preparing payment…"
          : enabled && publishableKey
            ? "Review secure payment"
            : "Payment not connected"}
      </button>
    </form>
  );
}
