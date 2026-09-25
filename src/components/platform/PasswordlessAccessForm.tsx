"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { MembershipBillingPlan } from "@/lib/membership/pricing";

type AuthResponse = {
  error?: string;
  ok?: boolean;
  redirectTo?: string;
  requestId?: string;
};

export default function PasswordlessAccessForm({ enabled, returnTo, onAuthenticated, signupPlan, onVerificationChange }: { enabled: boolean; returnTo?: string; onAuthenticated?: () => Promise<void> | void; signupPlan?: MembershipBillingPlan; onVerificationChange?: (started: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [resendDelay, setResendDelay] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (resendDelay <= 0) return;
    const timer = window.setTimeout(() => setResendDelay((seconds) => Math.max(0, seconds - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendDelay]);

  async function sendCode() {
    if (!enabled || pending) return;
    setPending(true);
    onVerificationChange?.(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/otp/request", {
        body: JSON.stringify({ email: email.trim().toLowerCase(), ...(signupPlan ? { signup: { plan: signupPlan } } : {}) }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as AuthResponse;
      if (!response.ok) throw new Error(payload.error || "Access could not be requested.");
      setRequestId(payload.requestId ?? null);
      setRequested(true);
      onVerificationChange?.(true);
      setResendDelay(60);
    } catch (requestError) {
      onVerificationChange?.(requested);
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
    if (!enabled || pending) return;
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/otp/verify", {
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          token: form.get("token"),
          returnTo,
          ...(signupPlan ? { signup: { plan: signupPlan } } : {}),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as AuthResponse;
      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error || "That code could not be verified.");
      }
      if (onAuthenticated) {
        await onAuthenticated();
        setPending(false);
      } else window.location.assign(payload.redirectTo);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "That code could not be verified.");
      setPending(false);
    }
  }

  if (!requested) {
    return (
      <form className="mt-8 grid gap-5" onSubmit={requestCode} aria-label={signupPlan ? "Create your membership account" : "Member sign in"}>
        <label className="grid gap-2">
          <span className="font-cadehandy2 text-xl leading-none text-[var(--member-red)]">
            Your email
          </span>
          <input
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect="off"
            className="min-h-13 rounded-[4px] border border-[var(--member-rule)] bg-white/24 px-4 text-base text-[var(--member-ink)] outline-none placeholder:text-[var(--member-muted)] focus:border-black focus:ring-2 focus:ring-[var(--color-shop)] disabled:opacity-40"
            disabled={!enabled || pending}
            maxLength={254}
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            spellCheck={false}
            type="email"
            value={email}
          />
        </label>

        {error ? <p aria-live="polite" className="text-sm text-[var(--member-red)]">{error}</p> : null}

        <button
          className="min-h-13 rounded-[4px] bg-[var(--member-yellow)] px-5 text-sm font-semibold text-[#2a2a2a]  transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#201d19] disabled:cursor-not-allowed disabled:bg-black/35 disabled:shadow-none motion-reduce:transition-none"
          disabled={!enabled || pending}
          type="submit"
        >
          {pending ? "Sending code…" : enabled ? signupPlan ? "Verify my email" : "Send access code" : signupPlan ? "Signup is not available yet" : "Secure access is not connected"}
        </button>

        {!enabled && !signupPlan && process.env.NODE_ENV !== "production" ? (
          <Link className="w-fit text-sm font-medium underline decoration-black/30 underline-offset-4" href="/my">
            Open the member preview
          </Link>
        ) : null}
      </form>
    );
  }

  return (
    <form className="mt-8 grid gap-5" onSubmit={verifyCode}>
      <p className="rounded-[4px] bg-black/[0.055] px-4 py-3 text-sm leading-relaxed text-[var(--member-muted)]" role="status">
        Request received for <span className="font-medium text-[var(--member-muted)]">{email.trim().toLowerCase()}</span>. {signupPlan ? "Check your inbox and spam folder. Enter the newest code below, or follow the email confirmation link and return here to continue." : "An active account or current invitation is needed to receive a code. Check your inbox and spam folder, then enter the newest code below."}
      </p>
      <label className="grid gap-2">
        <span className="font-cadehandy2 text-xl leading-none text-[var(--member-red)]">
          Access code
        </span>
        <input
          autoComplete="one-time-code"
          autoFocus
          className="min-h-14 min-w-0 w-full rounded-[4px] border border-[var(--member-rule)] bg-white/24 px-4 font-mono text-xl tracking-[0.28em] text-[var(--member-ink)] outline-none focus:border-black focus:ring-2 focus:ring-[var(--color-shop)]"
          inputMode="numeric"
          maxLength={10}
          minLength={6}
          name="token"
          pattern="[0-9]{6,10}"
          required
        />
      </label>

      {error ? <p aria-live="polite" className="text-sm text-[var(--member-red)]">{error}</p> : null}

      <button
        className="min-h-13 rounded-[4px] bg-[var(--member-yellow)] px-5 text-sm font-semibold text-[#2a2a2a]  transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#201d19] disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none"
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
            onVerificationChange?.(false);
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
      <div className="text-sm leading-relaxed text-[var(--member-muted)]">
        <p>Still no code? {signupPlan ? "Check that your email is correct, or request a new code." : "Your invitation may have expired, or email delivery may need attention."} <a className="underline underline-offset-4" href={`mailto:connect@theruinedproject.com?subject=${encodeURIComponent("Sign-in help")}&body=${encodeURIComponent(`I could not receive a sign-in code for ${email.trim().toLowerCase()}. Request reference: ${requestId ?? "not available"}.`)}`}>Contact connect@theruinedproject.com</a>.</p>
        {requestId ? <p className="mt-2 break-all text-xs">Request reference: {requestId}</p> : null}
      </div>
    </form>
  );
}
