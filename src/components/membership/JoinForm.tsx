"use client";

import { FormEvent, useRef, useState } from "react";

type CheckoutResponse = {
  checkoutUrl?: string;
  error?: string;
};

export default function JoinForm({
  disabledReason,
  email,
  enabled,
  minimumAge,
}: {
  disabledReason: string | null;
  email: string;
  enabled: boolean;
  minimumAge: number;
}) {
  const checkoutAttempt = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || submitting) return;

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
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as CheckoutResponse;

      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error || "Secure checkout is temporarily unavailable.");
      }

      window.location.assign(payload.checkoutUrl);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Secure checkout is temporarily unavailable.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-10 grid gap-6" onSubmit={handleSubmit}>
      <label className="grid gap-2">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-white/55">
          Email
        </span>
        <input
          autoComplete="email"
          className="min-h-12 border border-white/20 bg-white/[0.03] px-4 font-mono text-sm text-white/60 outline-none"
          disabled
          name="email"
          type="email"
          value={email}
        />
      </label>

      <div className="grid gap-4 border-y border-white/15 py-5 font-mono text-[0.68rem] leading-relaxed tracking-[0.04em] text-white/65">
        <label className="grid grid-cols-[1rem_1fr] items-start gap-3">
          <input
            className="mt-0.5 size-4 accent-white disabled:opacity-35"
            disabled={!enabled || submitting}
            name="age-confirmed"
            required
            type="checkbox"
          />
          <span>I confirm that I am at least {minimumAge} years old.</span>
        </label>
        <label className="grid grid-cols-[1rem_1fr] items-start gap-3">
          <input
            className="mt-0.5 size-4 accent-white disabled:opacity-35"
            disabled={!enabled || submitting}
            name="agreement-accepted"
            required
            type="checkbox"
          />
          <span>
            I accept the current <a className="underline underline-offset-4" href="/terms">membership terms</a> and <a className="underline underline-offset-4" href="/privacy">privacy policy</a>.
          </span>
        </label>
      </div>

      {error || disabledReason ? (
        <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 font-mono text-xs leading-relaxed text-white/70">
          {error ?? disabledReason}
        </p>
      ) : null}

      <button
        className="min-h-12 border border-white bg-white px-6 py-4 font-mono text-[0.7rem] uppercase tracking-[0.24em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50"
        disabled={!enabled || submitting}
        type="submit"
      >
        {submitting
          ? "Opening secure checkout…"
          : enabled
            ? "Continue to secure checkout"
            : "Checkout not connected"}
      </button>

      <p className="font-mono text-[0.58rem] uppercase leading-relaxed tracking-[0.18em] text-white/35">
        Membership billing is processed by Stripe. Retail purchases remain separate through Shopify.
      </p>
    </form>
  );
}
