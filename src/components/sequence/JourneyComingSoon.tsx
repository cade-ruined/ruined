"use client";

import { FormEvent, useId, useState } from "react";

const SECTION_LABELS = {
  store: "Store",
  artifacts: "Artifacts",
  about: "About",
} as const;

export default function JourneyComingSoon({ section }: { section: "store" | "artifacts" | "about" }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const emailId = useId();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState("sending");
    try {
      const email = String(new FormData(form).get("email") ?? "");
      const response = await fetch("/api/hubspot-signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, source: section }) });
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
  return <div className="border border-white/25 bg-black/80 p-4 text-white shadow-[7px_8px_0_rgba(0,0,0,0.5)] sm:p-6">
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="ui-heading text-xs text-[var(--color-poster)]">{SECTION_LABELS[section]}</p><p className="display mt-1 text-4xl leading-none sm:text-6xl">Coming soon.</p></div>
      <form onSubmit={submit} className="flex w-full max-w-md gap-2" aria-label={`${SECTION_LABELS[section]} email signup`} aria-busy={state === "sending"}>
        <label htmlFor={emailId} className="sr-only">Email address</label>
        <input id={emailId} name="email" type="email" required autoComplete="email" inputMode="email" placeholder="Email address" className="min-w-0 flex-1 border border-white/40 bg-transparent px-3 py-3 font-sans text-sm placeholder:text-white/45 focus:border-white focus:outline-none" />
        <button type="submit" disabled={state === "sending"} className="ui-heading border border-white bg-white px-4 py-3 text-xs text-black disabled:cursor-wait disabled:opacity-60">{state === "sending" ? "Joining…" : "Notify me"}</button>
      </form>
    </div>
    {state === "sent" && <p role="status" aria-live="polite" className="mt-3 text-sm">You’re on the list.</p>}
    {state === "error" && <p role="alert" aria-live="assertive" className="mt-3 text-sm text-[var(--color-poster)]">Signup is not connected yet.</p>}
  </div>;
}
