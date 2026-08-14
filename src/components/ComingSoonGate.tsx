"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useId, useState } from "react";

export default function ComingSoonGate({ title, image, source, signup = true }: { title: string; image: string; source: "store" | "artifacts" | "about"; signup?: boolean }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const emailId = useId();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState("sending");
    try {
      const body = Object.fromEntries(new FormData(form));
      const response = await fetch("/api/hubspot-signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, source }) });
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
  return <main className="relative min-h-screen overflow-hidden bg-black text-white">
    <Image src={image} alt="" fill priority sizes="100vw" className="object-cover opacity-70" />
    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/20" />
    <div className="relative mx-auto flex min-h-screen max-w-[96rem] flex-col justify-end px-5 pb-12 pt-28 sm:px-10 sm:pb-16">
      <Link href={`/#${source === "artifacts" ? "work" : source}`} className="ui-heading mb-auto w-fit text-xs text-white/70">← Return to the walk</Link>
      <p className="ui-heading text-sm text-[var(--color-poster)]">Coming soon</p>
      <h1 className="display mt-2 text-[clamp(4rem,12vw,10rem)] leading-[0.8]">{title}</h1>
      {signup && <form onSubmit={submit} className="mt-8 flex max-w-xl gap-2" aria-label={`${title} email signup`} aria-busy={state === "sending"}>
        <label htmlFor={emailId} className="sr-only">Email address</label>
        <input id={emailId} name="email" type="email" required autoComplete="email" inputMode="email" placeholder="Email address" className="min-w-0 flex-1 border border-white/45 bg-black/50 px-4 py-3 font-sans text-base text-white outline-none placeholder:text-white/45 focus:border-white" />
        <button type="submit" disabled={state === "sending"} className="ui-heading border border-white bg-white px-5 py-3 text-xs text-black disabled:cursor-wait disabled:opacity-60">{state === "sending" ? "Joining…" : "Notify me"}</button>
      </form>}
      {state === "sent" && <p role="status" aria-live="polite" className="mt-3 text-sm">You’re on the list.</p>}
      {state === "error" && <p role="alert" aria-live="assertive" className="mt-3 text-sm text-[var(--color-poster)]">Signup is not connected yet.</p>}
    </div>
  </main>;
}
