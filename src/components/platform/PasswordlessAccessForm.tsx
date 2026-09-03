"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type AuthResponse = {
  error?: string;
  ok?: boolean;
  redirectTo?: string;
};

export default function PasswordlessAccessForm({ enabled, returnTo }: { enabled: boolean; returnTo?: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [resendDelay, setResendDelay] = useState(0);

  useEffect(() => {
    if (resendDelay <= 0) return;
    const timer = window.setTimeout(() => setResendDelay((seconds) => Math.max(0, seconds - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendDelay]);

  async function sendCode() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/otp/request", {
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as AuthResponse;
      if (!response.ok) throw new Error(payload.error || "Access could not be requested.");
      setRequested(true);
      setResendDelay(60);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Access could not be requested.");
    } finally {
      setPending(false);
    }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendCode();
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/otp/verify", {
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          token: form.get("token"),
          returnTo,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as AuthResponse;
      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error || "That code could not be verified.");
      }
      window.location.assign(payload.redirectTo);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "That code could not be verified.");
      setPending(false);
    }
  }

  if (!requested) {
    return (
      <form className="mt-8 grid gap-5" onSubmit={requestCode}>
        <label className="grid gap-2">
          <span className="font-cadehandy2 text-xl leading-none text-[var(--color-poster)]">
            Your email
          </span>
          <input
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect="off"
            className="min-h-13 rounded-[4px] border border-black/28 bg-white/24 px-4 text-base text-[#201d19] outline-none placeholder:text-black/28 focus:border-black focus:ring-2 focus:ring-[var(--color-shop)] disabled:opacity-40"
            disabled={!enabled || pending}
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            spellCheck={false}
            type="email"
            value={email}
          />
        </label>

        {error ? <p aria-live="polite" className="text-sm text-[var(--color-poster)]">{error}</p> : null}

        <button
          className="min-h-13 rounded-[4px] bg-[#201d19] px-5 text-sm font-semibold text-[var(--color-bone)] shadow-[4px_4px_0_var(--color-shop)] transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#201d19] disabled:cursor-not-allowed disabled:bg-black/35 disabled:shadow-none motion-reduce:transition-none"
          disabled={!enabled || pending}
          type="submit"
        >
          {pending ? "Sending code…" : enabled ? "Send access code" : "Secure access is not connected"}
        </button>

        {!enabled && process.env.NODE_ENV !== "production" ? (
          <Link className="w-fit text-sm font-medium underline decoration-black/30 underline-offset-4" href="/my">
            Open the member preview
          </Link>
        ) : null}
      </form>
    );
  }

  return (
    <form className="mt-8 grid gap-5" onSubmit={verifyCode}>
      <p className="rounded-[4px] bg-black/[0.055] px-4 py-3 text-sm leading-relaxed text-black/58" role="status">
        If <span className="font-medium text-black">{email.trim().toLowerCase()}</span> is connected to Ruined, the code is on its way.
      </p>
      <label className="grid gap-2">
        <span className="font-cadehandy2 text-xl leading-none text-[var(--color-poster)]">
          Access code
        </span>
        <input
          autoComplete="one-time-code"
          autoFocus
          className="min-h-14 rounded-[4px] border border-black/28 bg-white/24 px-4 font-mono text-xl tracking-[0.28em] text-[#201d19] outline-none focus:border-black focus:ring-2 focus:ring-[var(--color-shop)]"
          inputMode="numeric"
          maxLength={10}
          minLength={6}
          name="token"
          pattern="[0-9]{6,10}"
          required
        />
      </label>

      {error ? <p aria-live="polite" className="text-sm text-[var(--color-poster)]">{error}</p> : null}

      <button
        className="min-h-13 rounded-[4px] bg-[#201d19] px-5 text-sm font-semibold text-[var(--color-bone)] shadow-[4px_4px_0_var(--color-shop)] transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#201d19] disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none"
        disabled={pending}
        type="submit"
      >
        {pending ? "Checking code…" : "Continue"}
      </button>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <button
          className="min-h-11 font-medium underline decoration-black/30 underline-offset-4 disabled:opacity-40"
          disabled={pending}
          onClick={() => {
            setRequested(false);
            setError(null);
          }}
          type="button"
        >
          Use another email
        </button>
        <button
          className="min-h-11 font-medium underline decoration-black/30 underline-offset-4 disabled:opacity-40"
          disabled={pending || resendDelay > 0}
          onClick={sendCode}
          type="button"
        >
          {resendDelay > 0 ? `Send again in ${resendDelay}s` : "Send a new code"}
        </button>
      </div>
    </form>
  );
}
