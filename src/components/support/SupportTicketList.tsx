import Link from "next/link";

import { SupportStatusBadge, supportDate } from "@/components/support/SupportShared";
import { supportCategoryLabel, type SupportTicketSummary } from "@/lib/support/model";

export default function SupportTicketList({ tickets, operator = false, emptyMessage = "No requests yet." }: { tickets: SupportTicketSummary[]; operator?: boolean; emptyMessage?: string }) {
  if (!tickets.length) return <p className="rounded-[4px] bg-black/[0.035] px-4 py-7 text-sm text-black/60">{emptyMessage}</p>;
  return (
    <ul className="grid gap-2">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Link className="group grid min-w-0 gap-3 rounded-[4px] bg-black/[0.035] px-4 py-4 transition-colors hover:bg-black/[0.065] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5" href={`${operator ? "/ops" : "/my"}/support/${ticket.id}`}>
            <div className="min-w-0">
              <p className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-black/60"><span>{ticket.number}</span><span>{supportCategoryLabel(ticket.category)}</span></p>
              <h3 className="ui-heading break-words text-base font-semibold leading-snug tracking-[-0.025em] [overflow-wrap:anywhere] sm:text-lg">{ticket.subject}</h3>
              {operator ? <p className="mt-1 break-all text-xs text-black/60">{ticket.requesterName} · {ticket.requesterEmail}</p> : null}
              {operator && (ticket.emailAttentionCount ?? 0) > 0 ? <p className="mt-2 text-xs text-[var(--color-poster)]">Email needs attention · {ticket.emailAttentionCount}</p> : null}
              <p className="mt-2 text-xs text-black/55">Updated <time dateTime={ticket.updatedAt}>{supportDate(ticket.updatedAt)}</time></p>
            </div>
            <div className="flex items-center justify-between gap-4 sm:justify-end"><SupportStatusBadge operator={operator} status={ticket.status} /><span aria-hidden="true" className="text-xl transition-transform group-hover:translate-x-1">→</span></div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
