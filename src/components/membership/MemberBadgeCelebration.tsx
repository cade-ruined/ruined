"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import MemberBadgeDialog from "./MemberBadgeDialog";
import type { BadgeDisplay } from "./MemberBadgeCard";
import styles from "./MemberBadgeCelebration.module.css";

const quietRoutes = ["/my/access", "/my/confirmed", "/my/join", "/my/payment-method", "/my/checkout", "/my/badges"];
type Queue = { ownerId: string; pathname: string | null; badges: readonly BadgeDisplay[]; revealKeys: string[]; index: number };
type Lifecycle = {
  ownerId: string; controller: AbortController; version: number;
  pendingRefresh: boolean; refresh: () => Promise<void>;
};
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
  const lifecycle = useRef<Lifecycle | null>(null);
  const writing = useRef(false);

  useEffect(() => {
    const current: Lifecycle = { ownerId, controller: new AbortController(), version: 0,
      pendingRefresh: false, refresh: async () => {} };
    lifecycle.current = current; writing.current = false;
    setBusy(false); setError(null);
    const preview = previewBadges === undefined ? null : validBadges(previewBadges);
    setQueue(preview === null ? null : { ownerId, pathname, badges: preview,
      revealKeys: preview.map(badge => badge.key), index: 0 });
    const isCurrent = () => !current.controller.signal.aborted && lifecycle.current === current;
    function suspend() { if (isCurrent()) { setQueue(null); current.controller.abort(); } }
    current.refresh = async () => {
      if (!isCurrent() || previewBadges !== undefined) return;
      if (writing.current) { current.pendingRefresh = true; return; }
      current.pendingRefresh = false;
      const version = ++current.version;
      try {
        const response = await fetch("/api/my/badges", { cache: "no-store", signal: current.controller.signal, headers: { "x-ruined-session-owner": ownerId } });
        if (!isCurrent() || version !== current.version) return;
        if ([401, 403, 409].includes(response.status)) { suspend(); return; }
        if (!response.ok) return;
        const result = await response.json();
        if (!isCurrent() || version !== current.version) return;
        if (result.ownerId !== ownerId) { suspend(); return; }
        const badges = validBadges(result.badges);
        // The API returns only unseen awards. Reveal them automatically, including
        // awards earned before this page loaded, without a separate notice click.
        setQueue(previous => {
          const pendingKeys = new Set(badges.map(badge => badge.key));
          const remaining = previous?.ownerId === ownerId && previous.pathname === pathname
            ? previous.revealKeys.slice(previous.index).filter(key => pendingKeys.has(key)) : [];
          const revealKeys = [...new Set([...remaining, ...pendingKeys])];
          return { ownerId, pathname, badges, revealKeys, index: 0 };
        });
      } catch { /* Leave unread awards on the server for the next visit. */ }
    };
    function progressChanged() { if (!document.hidden) void current.refresh(); }
    if (previewBadges === undefined) {
      void current.refresh();
      window.addEventListener("ruined:member-progress", progressChanged);
      window.addEventListener("focus", progressChanged);
      document.addEventListener("visibilitychange", progressChanged);
    }
    return () => {
      current.controller.abort(); window.removeEventListener("ruined:member-progress", progressChanged);
      window.removeEventListener("focus", progressChanged);
      document.removeEventListener("visibilitychange", progressChanged);
      if (lifecycle.current === current) lifecycle.current = null;
    };
  }, [ownerId, previewBadges, pathname]);

  const currentQueue = queue?.ownerId === ownerId && queue.pathname === pathname ? queue : null;
  const badge = currentQueue?.badges.find(item => item.key === currentQueue.revealKeys[currentQueue.index]);
  async function acknowledge() {
    const current = lifecycle.current;
    if (!badge || !currentQueue || !current || current.ownerId !== ownerId || current.controller.signal.aborted || writing.current) return;
    writing.current = true; current.version++; setBusy(true); setError(null);
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
        setQueue(value => value?.ownerId === ownerId && value.revealKeys[value.index] === badge.key
          ? { ...value, badges: value.badges.filter(item => item.key !== badge.key), index: value.index + 1 } : value);
      }
    } catch {
      if (!current.controller.signal.aborted && lifecycle.current === current) setError("We couldn’t save that dismissal. Your badge is still here. Try again.");
    } finally {
      if (!current.controller.signal.aborted && lifecycle.current === current) {
        writing.current = false; setBusy(false);
        if (current.pendingRefresh) void current.refresh();
      }
    }
  }

  if (!currentQueue || currentQueue.badges.length === 0) return null;
  const enabled = !quietRoutes.some(route => pathname === route || pathname?.startsWith(`${route}/`));
  return <>
    <MemberBadgeDialog badge={badge} id={id} celebration preview={previewBadges !== undefined} enabled={enabled && Boolean(badge)} busy={busy}
    className={styles.celebration} onDismiss={() => { void acknowledge(); }}>
    <div className={styles.actions}>
      {currentQueue.revealKeys.length > 1 ? <p className={styles.counter} aria-live="polite">Badge {currentQueue.index + 1} of {currentQueue.revealKeys.length}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.continue} type="button" disabled={busy} onClick={() => { void acknowledge(); }}>
        {busy ? "Saving…" : error ? "Try again" : currentQueue.index < currentQueue.revealKeys.length - 1 ? "Continue" : "Done"}
      </button>
    </div>
    </MemberBadgeDialog>
  </>;
}
