"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type AuthResponse = {
  error?: string;
  ok?: boolean;
  redirectTo?: string;
};

export default function PasswordlessAccessForm({
  audience,
  enabled,
  nextPath,
}: {
  audience: "member" | "ops";
  enabled: boolean;
  nextPath: "/my/join" | "/ops";
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/otp/request", {
        body: JSON.stringify({ audience, email, next: nextPath }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as AuthResponse;
      if (!response.ok) throw new Error(payload.error || "Access could not be requested.");
      setRequested(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Access could not be requested.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/otp/verify", {
        body: JSON.stringify({
          audience,
          email,
          next: nextPath,
          token: form.get("token"),
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
      <form className="mt-10 grid gap-6" onSubmit={requestCode}>
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/52">
            Email
          </span>
          <input
            autoComplete="email"
            className="min-h-12 border border-white/25 bg-transparent px-4 text-sm text-white outline-none placeholder:text-white/20 focus:border-white disabled:opacity-40"
            disabled={!enabled || pending}
            name="email"
            onChange={(event) => setEmail(event.target.value.trim().toLowerCase())}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </label>

        {error ? <p aria-live="polite" className="text-sm text-[var(--color-poster)]">{error}</p> : null}

        <button
          className="min-h-12 border border-white bg-white px-5 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-transparent disabled:text-white/30"
          disabled={!enabled || pending}
          type="submit"
        >
          {pending ? "Sending code…" : enabled ? "Send access code" : "Supabase not connected"}
        </button>

        {!enabled && process.env.NODE_ENV !== "production" ? (
          <Link className="w-fit border-b border-white/30 pb-1 text-xs uppercase tracking-[0.14em] text-white/55" href={nextPath}>
            Open read-only preview
          </Link>
        ) : null}
      </form>
    );
  }

  return (
    <form className="mt-10 grid gap-6" onSubmit={verifyCode}>
      <div className="border-y border-white/15 py-5 text-sm leading-relaxed text-white/55">
        If <span className="text-white">{email}</span> is eligible, an access code is on its way.
      </div>
      <label className="grid gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/52">
          Access code
        </span>
        <input
          autoComplete="one-time-code"
          autoFocus
          className="min-h-14 border border-white/25 bg-transparent px-4 font-mono text-xl tracking-[0.35em] text-white outline-none focus:border-white"
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
        className="min-h-12 border border-white bg-white px-5 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "Verifying…" : "Enter"}
      </button>
      <button
        className="w-fit border-b border-white/25 pb-1 text-xs uppercase tracking-[0.14em] text-white/45"
        onClick={() => setRequested(false)}
        type="button"
      >
        Use another email
      </button>
    </form>
  );
}
