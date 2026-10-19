"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import type { CommunicationBucket, CommunicationChannel } from "@/lib/communications/communications-catalog";

export default function OperatorMessagesTabs({ active, channel, bucket, onChannel, pending = false }: {
  active: "posts" | "alerts" | "emails" | "automations";
  channel?: CommunicationChannel;
  bucket?: CommunicationBucket | null;
  onChannel?: (value: CommunicationChannel) => void;
  pending?: boolean;
}) {
  const selected = channel ?? (active === "posts" || active === "alerts" ? "notifications" : "emails");
  return <nav aria-label="Communication channels" className="operator-glass mb-6 flex w-fit max-w-full flex-wrap gap-1 p-1">
    {([
      { id: "emails", label: "Emails" },
      { id: "texts", label: "Texts" },
      { id: "notifications", label: "Notifications" },
    ] as const).map(item => {
      const href = `/ops/messages?mode=automations${item.id === "emails" ? "" : `&channel=${item.id}`}${bucket ? `&bucket=${bucket}` : ""}`;
      const click = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!onChannel || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (!pending) onChannel(item.id);
      };
      return <Link aria-current={selected === item.id ? "page" : undefined} aria-disabled={pending || undefined} data-operator-tone={selected === item.id ? "info" : undefined} className={`inline-flex min-h-11 items-center justify-center px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--operator-focus)] ${selected === item.id ? "operator-emphasis" : "text-[color:var(--operator-muted)] hover:bg-[var(--operator-surface-hover)]"}`} href={href} onClick={click} key={item.id}>{item.label}</Link>;
    })}
  </nav>;
}
