"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { SupportPreviewNotice } from "@/components/support/SupportShared";
import SupportTicketList from "@/components/support/SupportTicketList";
import { SUPPORT_ACTION_CLASS, SUPPORT_FIELD_CLASS, SUPPORT_LABEL_CLASS, SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import { SUPPORT_CATEGORIES, SUPPORT_EMAIL, type SupportTicket, type SupportTicketSummary } from "@/lib/support/model";

export default function MemberSupport({ tickets, writable }: { tickets: SupportTicketSummary[]; writable: boolean }) {
  const router = useRouter();
  const requestKey = useRef("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      requestKey.current ||= crypto.randomUUID();
      const response = await fetch("/api/my/support", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": requestKey.current },
        body: JSON.stringify({ category: form.get("category"), subject: form.get("subject"), message: form.get("message") }),
      });
      const result = await response.json().catch(() => null) as { ticket?: SupportTicket; error?: string } | null;
      if (!response.ok || !result?.ticket) throw new Error(result?.error || "Your request couldn't be sent. Try again; your message is still here.");
      router.push(`/my/support/${result.ticket.id}`);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Your request couldn't be sent. Please try again.");
      setPending(false);
    }
  }

  return (
    <main className="mx-auto max-w-[78rem] pb-24 [font-family:var(--font-body)]">
      {!writable ? <SupportPreviewNotice /> : null}
      <header className="mb-7 flex flex-wrap items-end justify-between gap-2">
        <h1 className="ui-heading text-[clamp(2.7rem,6vw,4.3rem)] font-bold uppercase leading-[0.9] tracking-[-0.045em]">How can we help?</h1>
        <a className={SUPPORT_LINK_CLASS} href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </header>
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
        <section aria-labelledby="support-new-title">
          <h2 className="mb-5 text-3xl text-[var(--color-poster)]" id="support-new-title"><span className="[font-family:var(--font-cadehandy2)]">New request</span></h2>
          <form onChange={() => { requestKey.current = ""; }} onSubmit={submit}>
            <fieldset className="grid min-w-0 gap-5" disabled={pending}>
              <label><span className={SUPPORT_LABEL_CLASS}>Help topic</span><select className={SUPPORT_FIELD_CLASS} defaultValue="" name="category" required><option disabled value="">Choose a topic</option>{SUPPORT_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
              <label><span className={SUPPORT_LABEL_CLASS}>What do you need?</span><input autoCapitalize="sentences" className={SUPPORT_FIELD_CLASS} maxLength={120} minLength={3} name="subject" placeholder="A short summary" required /></label>
              <label><span className={SUPPORT_LABEL_CLASS}>Details</span><textarea aria-describedby="support-message-safety" className={`${SUPPORT_FIELD_CLASS} min-h-40 resize-y`} maxLength={5000} minLength={10} name="message" placeholder="Tell us a little more." required rows={5} /></label>
              <p className="-mt-2 text-xs leading-relaxed text-black/60" id="support-message-safety">Keep passwords, sign-in codes, and card details out of your message.</p>
              {error ? <p className="text-sm leading-relaxed text-[var(--color-poster)]" role="alert">{error}</p> : null}
              <button className={`${SUPPORT_ACTION_CLASS} w-fit`} disabled={!writable || pending} type="submit">{pending ? "Sending…" : "Send request"}<span aria-hidden="true">↗</span></button>
            </fieldset>
          </form>
        </section>
        <section aria-labelledby="support-requests-title">
          <div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-3xl text-[var(--color-poster)]" id="support-requests-title"><span className="[font-family:var(--font-cadehandy2)]">Your requests</span></h2><span className="text-sm text-black/60">{tickets.length}</span></div>
          <SupportTicketList tickets={tickets} />
          {tickets.length >= 200 ? <p className="mt-3 text-xs text-black/60">Showing your 200 most recently updated requests. Email us if you need an older request.</p> : null}
        </section>
      </div>
    </main>
  );
}
