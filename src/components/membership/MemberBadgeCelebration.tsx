"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import MemberBadgeDialog from "./MemberBadgeDialog";
import type { BadgeDisplay } from "./MemberBadgeCard";
import styles from "./MemberBadgeCelebration.module.css";

const quietRoutes = ["/my/access", "/my/confirmed", "/my/join", "/my/payment-method", "/my/checkout"];
type Queue = { ownerId: string; badges: readonly BadgeDisplay[]; index: number };
function validBadges(value: unknown): BadgeDisplay[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((badge): badge is BadgeDisplay => {
    if (!badge || typeof badge.key !== "string" || !badge.key || seen.has(badge.key)
      || typeof badge.label !== "string" || typeof badge.description !== "string"
      || typeof badge.earnedAt !== "string" || !Number.isFinite(Date.parse(badge.earnedAt))) return false;
    seen.add(badge.key); return true;
  });
}

/** Unseen awards live on the server. No cookie/localStorage state can cross accounts. */
export default function MemberBadgeCelebration({ ownerId, previewBadges }: {
  ownerId: string; previewBadges?: readonly BadgeDisplay[];
}) {
  const pathname = usePathname();
  const id = useId();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifecycle = useRef<{ ownerId: string; controller: AbortController } | null>(null);
  const writing = useRef(false);

  useEffect(() => {
    const current = { ownerId, controller: new AbortController() };
    lifecycle.current = current; writing.current = false;
    setBusy(false); setError(null);
    setQueue(previewBadges === undefined ? null : { ownerId, badges: validBadges(previewBadges), index: 0 });
    if (previewBadges === undefined) {
      void fetch("/api/my/badges", { cache: "no-store", signal: current.controller.signal })
        .then(async response => {
          if (!response.ok) return;
          const result = await response.json();
          if (!current.controller.signal.aborted && lifecycle.current === current && result.ownerId === ownerId) {
            setQueue({ ownerId, badges: validBadges(result.badges), index: 0 });
          }
        }).catch(() => { /* Leave unread awards on the server for the next visit. */ });
    }
    return () => { current.controller.abort(); if (lifecycle.current === current) lifecycle.current = null; };
  }, [ownerId, previewBadges]);

  const badge = queue?.ownerId === ownerId ? queue.badges[queue.index] : undefined;
  async function acknowledge() {
    const current = lifecycle.current;
    if (!badge || !queue || !current || current.ownerId !== ownerId || current.controller.signal.aborted || writing.current) return;
    writing.current = true; setBusy(true); setError(null);
    try {
      if (previewBadges === undefined) {
        const response = await fetch("/api/my/badges", { method: "POST", signal: current.controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ badgeKey: badge.key, ownerId }) });
        if ([401, 403, 409].includes(response.status)) {
          // Authentication changed. Do not leave an old owner's award on screen,
          // or fetch a new owner's queue without the authenticated shell remount.
          if (!current.controller.signal.aborted && lifecycle.current === current) {
            setQueue(null); current.controller.abort();
          }
          return;
        }
        const result = await response.json();
        if (!response.ok || result.ok !== true) throw new Error("Acknowledgement unavailable");
      }
      if (!current.controller.signal.aborted && lifecycle.current === current) {
        setQueue(value => value?.ownerId === ownerId && value.badges[value.index]?.key === badge.key ? { ...value, index: value.index + 1 } : value);
      }
    } catch {
      if (!current.controller.signal.aborted && lifecycle.current === current) setError("We couldn’t save that dismissal. Your badge is still here. Try again.");
    } finally {
      if (!current.controller.signal.aborted && lifecycle.current === current) { writing.current = false; setBusy(false); }
    }
  }

  if (!badge || !queue) return null;
  const enabled = !quietRoutes.some(route => pathname === route || pathname?.startsWith(`${route}/`));
  return <MemberBadgeDialog badge={badge} id={id} celebration preview={previewBadges !== undefined} enabled={enabled} busy={busy}
    className={styles.celebration} onDismiss={() => { void acknowledge(); }}>
    <div className={styles.actions}>
      {queue.badges.length > 1 ? <p className={styles.counter} aria-live="polite">Badge {queue.index + 1} of {queue.badges.length}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.continue} type="button" disabled={busy} onClick={() => { void acknowledge(); }}>
        {busy ? "Saving…" : error ? "Try again" : queue.index < queue.badges.length - 1 ? "Continue" : "Done"}
      </button>
    </div>
  </MemberBadgeDialog>;
}
