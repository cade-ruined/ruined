"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { canPresentMemberAnnouncement, createMemberNotificationSession, MEMBER_UPDATES_CHANGED } from "@/lib/membership/notification-inbox-client";
import type { MemberNotificationState } from "@/lib/membership/notification-inbox-model";
import MemberIcon from "./MemberIcon";
import styles from "./MemberNotificationCenter.module.css";

const PREVIEW_OWNER = "preview-notifications";
const PREVIEW_KEY = "ruined-preview-library-announcement";

export default function MemberNotificationCenter({ ownerId, preview = false }: { ownerId?: string; preview?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const id = useId();
  const [state, setState] = useState<MemberNotificationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const sessionRef = useRef<ReturnType<typeof createMemberNotificationSession> | null>(null);
  const presented = useRef<string | null>(null);
  const writing = useRef(false);
  const expectedOwner = preview ? PREVIEW_OWNER : ownerId;

  useEffect(() => {
    setState(null); setBusy(false); setError(null); presented.current = null; writing.current = false;
    if (preview) {
      // This opt-in demo is unreachable in the production platform mode.
      const showPreview = new URLSearchParams(window.location.search).get("announcement") === "preview";
      let dismissed: string | null = null;
      try { dismissed = window.sessionStorage.getItem(PREVIEW_KEY); } catch { /* Preview remains usable without storage. */ }
      setState({ ownerId: PREVIEW_OWNER, unreadCount: dismissed === "open" ? 1 : 2,
        announcement: dismissed || !showPreview ? null : { id: "preview-library-launch", title: "The Library is live", body: "Watch Foundations 01, our first call, now in the Library. Revisit the conversation, then return to The Work whenever you’re ready.", actionLabel: "Open Library", href: "/my/library", publishedAt: "2026-11-06T18:00:00.000Z" } });
      return;
    }
    if (!ownerId) return;
    const session = createMemberNotificationSession({ ownerId, onChange: setState });
    sessionRef.current = session;
    const refresh = () => { if (!document.hidden) void session.refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(MEMBER_UPDATES_CHANGED, refresh);
    window.addEventListener("ruined:member-session-restored", refresh);
    return () => {
      session.stop(); if (sessionRef.current === session) sessionRef.current = null;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(MEMBER_UPDATES_CHANGED, refresh);
      window.removeEventListener("ruined:member-session-restored", refresh);
    };
  }, [ownerId, preview]);

  const current = state?.ownerId === expectedOwner ? state : null;
  const announcement = current?.announcement ?? null;
  const allowed = canPresentMemberAnnouncement(pathname);
  const candidateId = announcement?.id;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !candidateId) return;
    let previousFocus: Element | null = null;
    function closeForNow() {
      if (!dialog!.open) return;
      dialog!.close();
      if (!document.hidden && !document.querySelector("dialog[open]") && previousFocus instanceof HTMLElement
        && previousFocus.isConnected && !previousFocus.closest("[hidden],[inert]")) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }
    function reconcile() {
      const competing = [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')]
        .some(other => other !== dialog && !other.closest("[hidden],[inert]") && other.getClientRects().length > 0);
      if (!allowed || document.hidden || dialog!.closest("[hidden],[inert]") || competing) { closeForNow(); return; }
      if (dialog!.open || !dialog!.isConnected || (presented.current && presented.current !== candidateId)) return;
      // Never pull focus away from an entry or another form.
      if (document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return;
      previousFocus = document.activeElement;
      presented.current = candidateId!;
      dialog!.showModal(); dismissRef.current?.focus({ preventScroll: true });
    }
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "inert"] });
    document.addEventListener("visibilitychange", reconcile);
    document.addEventListener("focusin", reconcile);
    reconcile();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", reconcile); document.removeEventListener("focusin", reconcile); closeForNow(); };
  }, [candidateId, allowed]);

  async function respond(action: "dismiss" | "open") {
    if (!announcement || writing.current) return;
    writing.current = true; setBusy(true); setError(null);
    const activeSession = sessionRef.current;
    try {
      if (preview) {
        try { window.sessionStorage.setItem(PREVIEW_KEY, action); } catch { /* No real account data is written in preview. */ }
        setState(value => value ? { ...value, announcement: null, unreadCount: action === "open" ? Math.max(0, value.unreadCount - 1) : value.unreadCount } : null);
      } else if (!activeSession || !await activeSession.acknowledge(announcement.id, action)) return;
      if (!preview && activeSession !== sessionRef.current) return;
      if (action === "open") router.push(announcement.href ?? "/my/updates");
      window.dispatchEvent(new Event(MEMBER_UPDATES_CHANGED));
    } catch {
      if (preview || activeSession === sessionRef.current) setError("We couldn’t save that choice. Please try again.");
    } finally {
      if (preview || activeSession === sessionRef.current) { writing.current = false; setBusy(false); }
    }
  }

  const unreadCount = current?.unreadCount ?? 0;
  return <>
    <Link className={styles.bell} href="/my/updates" aria-label={unreadCount ? `Updates — ${unreadCount} unread` : "Updates"} title={unreadCount ? `${unreadCount} unread ${unreadCount === 1 ? "update" : "updates"}` : "Updates"}>
      <MemberIcon name="bell" />{unreadCount ? <span className={styles.dot} aria-hidden="true" /> : null}
    </Link>
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}
      onCancel={event => { event.preventDefault(); if (!busy) void respond("dismiss"); }}>
      {announcement ? <div className={styles.inner}>
        <div className={styles.topline}><p>From Ruined</p><button aria-label="Dismiss announcement" className={styles.close} type="button" disabled={busy} onClick={() => void respond("dismiss")}>×</button></div>
        <p className={styles.eyebrow}>Member update</p>
        <h2 id={`${id}-title`} className={styles.title}>{announcement.title}</h2>
        <p id={`${id}-body`} className={styles.body}>{announcement.body}</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void respond("open")}>{busy ? "Saving…" : announcement.actionLabel ?? "View update"}<span aria-hidden="true">↗</span></button>
          <button ref={dismissRef} type="button" className={styles.later} disabled={busy} onClick={() => void respond("dismiss")}>Not now</button>
        </div>
        <p className={styles.footnote}>You can find this again in Updates.</p>
        {preview ? <p className={styles.preview}>Preview only · No notification has been sent</p> : null}
      </div> : null}
    </dialog>
  </>;
}
