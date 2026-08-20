"use client";

import Link from "next/link";
import { FormEvent, useId, useState } from "react";

import {
  EMAIL_CONSENT_NOTICES,
  GENERAL_COMMUNICATION_SOURCE,
} from "@/lib/communications/model";

export default function EmailSignupForm({
  variant = "hero",
}: {
  variant?: "hero" | "panel";
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const emailId = useId();
  const consentId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState("sending");

    try {
      const response = await fetch("/api/communications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: data.get("company"),
          consent: data.get("consent") === "on",
          email: data.get("email"),
        }),
      });

      if (!response.ok) {
        setState("error");
        return;
      }

      form.reset();
      setState("sent");
    } catch {
      setState("error");
    }
  }

  const compact = variant === "panel";

  return <form
    onSubmit={submit}
    className={compact ? "w-full max-w-md" : "mt-8 max-w-xl"}
    aria-label="Ruined updates email signup"
    aria-busy={state === "sending"}
  >
    <div className="flex gap-2">
      <label htmlFor={emailId} className="sr-only">Email address</label>
      <input
        id={emailId}
        name="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder="Email address"
        className={compact
          ? "min-w-0 flex-1 border border-white/40 bg-transparent px-3 py-3 font-sans text-sm placeholder:text-white/45 focus:border-white focus:outline-none"
          : "min-w-0 flex-1 border border-white/45 bg-black/50 px-4 py-3 font-sans text-base text-white outline-none placeholder:text-white/45 focus:border-white"}
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className={`ui-heading border border-white bg-white py-3 text-xs text-black disabled:cursor-wait disabled:opacity-60 ${compact ? "px-4" : "px-5"}`}
      >
        {state === "sending" ? "Joining…" : "Notify me"}
      </button>
    </div>

    <input
      name="company"
      type="text"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      className="absolute left-[-9999px] h-px w-px opacity-0"
    />

    <label htmlFor={consentId} className="mt-3 flex cursor-pointer items-start gap-2 font-sans text-xs leading-relaxed text-white/65">
      <input
        id={consentId}
        name="consent"
        type="checkbox"
        required
        className="mt-0.5 size-3.5 shrink-0 accent-white"
      />
      <span>
        {EMAIL_CONSENT_NOTICES[GENERAL_COMMUNICATION_SOURCE]}{" "}
        <Link href="/privacy" className="underline decoration-white/35 underline-offset-2 hover:decoration-white">Privacy</Link>
      </span>
    </label>

    {state === "sent" && <p role="status" aria-live="polite" className="mt-3 text-sm">Check your email to confirm.</p>}
    {state === "error" && <p role="alert" aria-live="assertive" className="mt-3 text-sm text-[var(--color-poster)]">Signup is temporarily unavailable.</p>}
  </form>;
}
