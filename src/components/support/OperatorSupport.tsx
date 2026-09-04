"use client";

import { useMemo, useState } from "react";

import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { SupportPreviewNotice } from "@/components/support/SupportShared";
import SupportTicketList from "@/components/support/SupportTicketList";
import { SUPPORT_FIELD_CLASS, SUPPORT_LABEL_CLASS } from "@/components/support/supportStyles";
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES, supportStatusLabel, type SupportTicketSummary } from "@/lib/support/model";

export default function OperatorSupport({ tickets, writable, emailReady = false }: { tickets: SupportTicketSummary[]; writable: boolean; emailReady?: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("unresolved");
  const [category, setCategory] = useState("all");
  const filtered = useMemo(() => tickets.filter((ticket) => {
    if (status === "email_attention" ? !ticket.emailAttentionCount : status === "unresolved" ? ticket.status === "resolved" : status !== "all" && ticket.status !== status) return false;
    if (category !== "all" && ticket.category !== category) return false;
    const search = query.trim().toLowerCase();
    return !search || `${ticket.number} ${ticket.subject} ${ticket.requesterName} ${ticket.requesterEmail}`.toLowerCase().includes(search);
  }), [tickets, query, status, category]);

  return (
    <OperatorPageFrame title="Support">
      <div className="mx-auto max-w-[78rem] [font-family:var(--font-body)]">
        {!writable ? <SupportPreviewNotice /> : null}
        {writable && !emailReady ? <p className="mb-6 rounded-[4px] bg-[var(--color-signal)]/40 px-4 py-3 text-sm text-black/80" role="status">Requests are saved here. Email notifications to connect@ are not enabled yet.</p> : null}
        <section aria-label="Support snapshot" className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { label: "New", value: "open", color: "bg-[var(--color-faded)] text-[var(--color-bone)]" },
            { label: "In progress", value: "in_progress", color: "bg-[var(--color-shop)] text-black" },
            { label: "Waiting for member", value: "waiting_on_member", color: "bg-[var(--color-signal)] text-black" },
          ].map((item) => <button aria-pressed={status === item.value} className={`rounded-[4px] px-3 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black sm:px-5 ${item.color}`} key={item.value} onClick={() => setStatus(item.value)} type="button"><strong className="ui-heading block text-3xl font-bold sm:text-4xl">{tickets.filter((ticket) => ticket.status === item.value).length}</strong><span className="mt-1 block text-xs leading-snug sm:text-sm">{item.label}</span></button>)}
        </section>
        {tickets.some((ticket) => ticket.emailAttentionCount) ? <button className="mt-4 text-sm text-[var(--color-poster)] underline underline-offset-4" onClick={() => { setStatus("email_attention"); setCategory("all"); setQuery(""); }} type="button">Review email notifications · {tickets.reduce((count, ticket) => count + (ticket.emailAttentionCount ?? 0), 0)}</button> : null}
        <div className="my-7 grid items-end gap-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="sm:col-span-2 lg:col-span-1"><span className={SUPPORT_LABEL_CLASS}>Find a request</span><input className={SUPPORT_FIELD_CLASS} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, subject, or request number" type="search" value={query} /></label>
          <label><span className={SUPPORT_LABEL_CLASS}>Status</span><select className={SUPPORT_FIELD_CLASS} onChange={(event) => setStatus(event.target.value)} value={status}><option value="unresolved">All unresolved</option><option value="all">All statuses</option><option value="email_attention">Email needs attention</option>{SUPPORT_STATUSES.map((item) => <option key={item.value} value={item.value}>{supportStatusLabel(item.value, true)}</option>)}</select></label>
          <label><span className={SUPPORT_LABEL_CLASS}>Help topic</span><select className={SUPPORT_FIELD_CLASS} onChange={(event) => setCategory(event.target.value)} value={category}><option value="all">All topics</option>{SUPPORT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-3xl text-[var(--color-poster)]"><span className="[font-family:var(--font-cadehandy2)]">Requests</span></h2><p aria-live="polite" className="text-sm text-black/60">{filtered.length} shown</p></div>
        <SupportTicketList emptyMessage="No requests match these filters." operator tickets={filtered} />
        {tickets.length >= 200 ? <p className="mt-3 text-xs text-black/60">Showing the 200 most recently updated requests. Counts and filters apply to these requests.</p> : null}
      </div>
    </OperatorPageFrame>
  );
}
