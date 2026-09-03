"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { SupportPreviewNotice, SupportStatusBadge, supportDate } from "@/components/support/SupportShared";
import { SUPPORT_ACTION_CLASS, SUPPORT_FIELD_CLASS, SUPPORT_LABEL_CLASS, SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import { SUPPORT_STATUSES, supportCategoryLabel, supportStatusLabel, type SupportStatus, type SupportTicket } from "@/lib/support/model";

export default function SupportThread({ initialTicket, writable, operator = false }: { initialTicket: SupportTicket; writable: boolean; operator?: boolean }) {
  const router = useRouter();
  const requestKey = useRef("");
  const [ticket, setTicket] = useState(initialTicket);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<SupportStatus>(initialTicket.status);
  const [pending, setPending] = useState<"reply" | "status" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const basePath = operator ? "/ops/support" : "/my/support";
  const endpoint = `/api${basePath}/${ticket.id}`;
  const Title = operator ? "h2" : "h1";

  useEffect(() => {
    setTicket(initialTicket);
    setStatus(initialTicket.status);
    setConflict(false);
    setError("");
    setNotice("");
  }, [initialTicket]);

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || pending || !message.trim()) return;
    setPending("reply");
    setError("");
    setNotice("");
    try {
      requestKey.current ||= crypto.randomUUID();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": requestKey.current },
        body: JSON.stringify({ message }),
      });
      const result = await response.json().catch(() => null) as { ticket?: SupportTicket; error?: string } | null;
      if (!response.ok || !result?.ticket) throw new Error(result?.error || "Your reply couldn't be sent. Your message is still here.");
      setTicket(result.ticket);
      setStatus(result.ticket.status);
      setMessage("");
      requestKey.current = "";
      setNotice("Reply sent.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Your reply couldn't be sent. Please try again.");
    } finally {
      setPending(null);
    }
  }

  async function updateStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || !operator || pending || status === ticket.status) return;
    setPending("status");
    setError("");
    setNotice("");
    setConflict(false);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, expectedUpdatedAt: ticket.updatedAt }),
      });
      const result = await response.json().catch(() => null) as { ticket?: SupportTicket; error?: string } | null;
      if (response.status === 409) setConflict(true);
      if (!response.ok || !result?.ticket) throw new Error(result?.error || "The status couldn't be saved.");
      setTicket(result.ticket);
      setStatus(result.ticket.status);
      setNotice("Status saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The status couldn't be saved.");
    } finally {
      setPending(null);
    }
  }

  const content = (
    <div className="mx-auto max-w-[70rem] pb-16 [font-family:var(--font-body)]">
      {!writable ? <SupportPreviewNotice /> : null}
      <Link className={`${SUPPORT_LINK_CLASS} mb-5`} href={basePath}><span aria-hidden="true">←</span>{operator ? "All requests" : "Your requests"}</Link>
      <header className="mb-7">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-black/60"><span>{ticket.number}</span><span>{supportCategoryLabel(ticket.category)}</span><SupportStatusBadge operator={operator} status={ticket.status} /></div>
        <Title className="ui-heading max-w-4xl break-words text-[clamp(2rem,4vw,3.4rem)] font-bold uppercase leading-[0.98] tracking-[-0.04em] [overflow-wrap:anywhere]">{ticket.subject}</Title>
        {operator ? <p className="mt-3 break-all text-sm text-black/65">{ticket.requesterName} · {ticket.requesterEmail}</p> : null}
      </header>
      <div className={`grid items-start gap-8 ${operator ? "lg:grid-cols-[minmax(0,1fr)_17rem]" : ""}`}>
        <div className="min-w-0">
          <ol aria-label="Conversation" className="grid gap-3">
            {ticket.messages.map((item) => <li className={`min-w-0 rounded-[4px] p-4 sm:p-5 ${item.authorType === "operator" ? "bg-[var(--color-shop)]/45" : "bg-black/[0.035]"}`} key={item.id}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="min-w-0 text-2xl leading-none text-[var(--color-poster)] [overflow-wrap:anywhere]"><span className="[font-family:var(--font-cadehandy2)]">{item.authorType === "operator" ? "Ruined support" : operator ? ticket.requesterName : "You"}</span></h2><time className="text-xs text-black/60" dateTime={item.createdAt}>{supportDate(item.createdAt, true)} MT</time></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed sm:text-base [overflow-wrap:anywhere]">{item.body}</p></li>)}
          </ol>
          <form className="mt-7" onSubmit={submitReply}>
            <label><span className={SUPPORT_LABEL_CLASS}>{ticket.status === "resolved" && !operator ? "Need anything else?" : "Reply"}</span><textarea aria-describedby="support-reply-guidance" className={`${SUPPORT_FIELD_CLASS} min-h-32 resize-y`} disabled={pending !== null} maxLength={5000} minLength={1} onChange={(event) => { setMessage(event.target.value); requestKey.current = ""; }} placeholder={operator ? "Write a reply to the member." : "Add a message."} required rows={4} value={message} /></label>
            <p className="mt-2 text-xs leading-relaxed text-black/60" id="support-reply-guidance">{ticket.status === "resolved" && !operator ? "A new reply reopens this request. " : ""}Keep passwords, sign-in codes, and card details out of your message.</p>
            <button className={`${SUPPORT_ACTION_CLASS} mt-4`} disabled={!writable || pending !== null || !message.trim()} type="submit">{pending === "reply" ? "Sending…" : "Send reply"}<span aria-hidden="true">↗</span></button>
          </form>
        </div>
        {operator ? <aside><form className="rounded-[4px] bg-black/[0.035] p-4 sm:p-5" onSubmit={updateStatus}><label><span className={SUPPORT_LABEL_CLASS}>Status</span><select className={SUPPORT_FIELD_CLASS} disabled={!writable || pending !== null} onChange={(event) => setStatus(event.target.value as SupportStatus)} value={status}>{SUPPORT_STATUSES.map((item) => <option key={item.value} value={item.value}>{supportStatusLabel(item.value, true)}</option>)}</select></label><button className={`${SUPPORT_ACTION_CLASS} mt-4 w-full`} disabled={!writable || pending !== null || status === ticket.status || conflict} type="submit">{pending === "status" ? "Saving…" : "Save status"}</button></form><dl className="mt-5 grid gap-3 text-xs text-black/60"><div><dt className="font-medium text-black/75">Opened</dt><dd className="mt-1"><time dateTime={ticket.createdAt}>{supportDate(ticket.createdAt, true)} MT</time></dd></div><div><dt className="font-medium text-black/75">Last activity</dt><dd className="mt-1"><time dateTime={ticket.updatedAt}>{supportDate(ticket.updatedAt, true)} MT</time></dd></div></dl></aside> : null}
      </div>
      {error ? <div className="mt-5 max-w-xl text-sm leading-relaxed text-[var(--color-poster)]" role="alert"><p>{error}</p>{conflict ? <button className={SUPPORT_LINK_CLASS} onClick={() => router.refresh()} type="button">Reload request</button> : null}</div> : null}
      {notice ? <p className="mt-5 text-sm text-[var(--color-verdigris)]" role="status">{notice}</p> : null}
    </div>
  );

  return operator ? <OperatorPageFrame title={ticket.subject}>{content}</OperatorPageFrame> : <main>{content}</main>;
}
