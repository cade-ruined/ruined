"use client";

import Link from "next/link";
import { useState } from "react";

import MemberPageHeader, { MemberEmptyRoom } from "@/components/membership/MemberPageHeader";
import type { MemberUpdatesSnapshot } from "@/lib/membership/model";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(value));
}

export default function MemberUpdates({ initialUpdates, writable }: { initialUpdates: MemberUpdatesSnapshot; writable: boolean }) {
  const [updates, setUpdates] = useState(initialUpdates);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function markRead(id: string) {
    if (!writable || pendingId) return;
    setPendingId(id);
    setError(null);
    try {
      const response = await fetch("/api/my/updates/read", {
        body: JSON.stringify({ notificationId: id }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "That update could not be marked read.");
      setUpdates((current) => ({
        ...current,
        items: current.items.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item),
        unreadCount: Math.max(0, current.unreadCount - 1),
      }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "That update could not be marked read.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main>
      <MemberPageHeader
        eyebrow="Ruined Membership / Updates"
        imageIntent="A single folded note on a dark table. No phone, no notification graphics, no clutter."
        imageSequence="06"
        note="only what changed"
        summary="Member announcements and personal notices, kept in one quiet record instead of scattered across the experience."
        title="A signal, not a feed."
      />
      <section className="mt-20">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-black/20 pb-7">
          <div>
            <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">Current record</p>
            <h2 className="mt-4 font-[var(--font-display)] text-5xl leading-none tracking-[-0.04em]">{updates.unreadCount ? `${updates.unreadCount} unread.` : "You are current."}</h2>
          </div>
          <Link className="font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-black/45 underline decoration-black/20 underline-offset-8" href="/my">Membership home</Link>
        </div>
        {error ? <p aria-live="polite" className="mt-6 border-l-2 border-[var(--color-poster)] pl-4 font-[var(--font-body)] text-sm text-black/60">{error}</p> : null}
        {updates.items.length ? (
          <ol>
            {updates.items.map((item) => (
              <li className={`grid gap-6 border-b border-black/20 py-9 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:gap-9 sm:py-11 ${item.kind === "notification" && !item.readAt ? "bg-black/[0.025]" : ""}`} key={`${item.kind}-${item.id}`}>
                <div>
                  <p className="font-[var(--font-body)] text-[0.6rem] uppercase tracking-[0.14em] text-[var(--color-poster)]">{item.kind}</p>
                  <time className="mt-3 block font-[var(--font-body)] text-xs text-black/35">{formatDate(item.publishedAt)}</time>
                </div>
                <div>
                  <h3 className="font-[var(--font-display)] text-4xl leading-[0.94] tracking-[-0.035em]">{item.title}</h3>
                  <p className="mt-5 max-w-3xl whitespace-pre-wrap font-[var(--font-body)] text-sm leading-relaxed text-black/56 sm:text-base">{item.body}</p>
                  {item.href ? <Link className="mt-6 inline-flex font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-black/48 underline decoration-black/25 underline-offset-8 hover:text-black" href={item.href}>Continue →</Link> : null}
                </div>
                <div>
                  {item.kind === "notification" && !item.readAt ? (
                    <button className="font-[var(--font-body)] text-xs uppercase tracking-[0.13em] text-black/45 underline decoration-black/20 underline-offset-8 hover:text-black disabled:opacity-40" disabled={!writable || pendingId === item.id} onClick={() => markRead(item.id)} type="button">{pendingId === item.id ? "Saving" : "Mark read"}</button>
                  ) : <span className="font-[var(--font-body)] text-[0.6rem] uppercase tracking-[0.13em] text-black/30">Read</span>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <MemberEmptyRoom body="When there is a real change to your membership, Circle, Foundations, artifact, or schedule, it will appear here." title="There are no updates." />
        )}
      </section>
    </main>
  );
}
