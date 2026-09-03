import Link from "next/link";

import { SUPPORT_EMAIL, supportStatusLabel, type SupportStatus } from "@/lib/support/model";
import { SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";

export function supportDate(value: string, detailed = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(detailed ? { hour: "numeric", minute: "2-digit" } as const : {}),
    timeZone: "America/Denver",
  }).format(date);
}

export function SupportStatusBadge({ status, operator = false }: { status: SupportStatus; operator?: boolean }) {
  return (
    <span className={`inline-flex w-fit items-center gap-2 rounded-[3px] px-2.5 py-1.5 text-xs font-medium ${
      status === "resolved" ? "bg-[var(--color-verdigris)] text-white" :
      status === "waiting_on_member" ? "bg-[var(--color-signal)] text-black" :
      status === "in_progress" ? "bg-[var(--color-shop)] text-black" : "bg-black/[0.07] text-black/70"
    }`}>
      {supportStatusLabel(status, operator)}
    </span>
  );
}

export function SupportPreviewNotice() {
  return <p className="mb-6 w-fit rounded-[3px] bg-[var(--color-signal)] px-3 py-2 text-sm text-black" role="status">Preview — requests are not sent.</p>;
}

export function SupportUnavailable({ denied = false }: { denied?: boolean }) {
  return (
    <section className="rounded-[4px] bg-[var(--color-bone)] p-6 [font-family:var(--font-body)] text-[var(--color-faded)] sm:p-8">
      <h1 className="ui-heading text-3xl font-bold uppercase leading-none tracking-[-0.04em]">{denied ? "Support access required" : "Support is temporarily unavailable"}</h1>
      <p className="mt-4 max-w-lg text-sm leading-relaxed">{denied ? "This account cannot open this support area." : "Your requests are safe. You can contact the team by email while we reconnect."}</p>
      <a className={`mt-3 ${SUPPORT_LINK_CLASS}`} href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      <div><Link className={SUPPORT_LINK_CLASS} href="/my">Back to profile</Link></div>
    </section>
  );
}
