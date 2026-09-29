"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import MemberBadgeCard, { MemberBadgeDownload, type BadgeDisplay } from "./MemberBadgeCard";
import styles from "./MemberBadges.module.css";

export default function MemberBadgeDialog({ badge, id, onDismiss, preview = false, celebration = false,
  enabled = true, busy = false, returnFocus, children, className = "" }: {
  badge?: BadgeDisplay; id: string; onDismiss: () => void; preview?: boolean; celebration?: boolean;
  enabled?: boolean; busy?: boolean; returnFocus?: RefObject<HTMLButtonElement | null>;
  children?: ReactNode; className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeKey = badge?.key;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!activeKey || !dialog) return;
    let previousFocus: Element | null = null;
    function closeForNow() {
      if (dialog!.open) dialog!.close();
      if (!document.hidden && !document.querySelector("dialog[open]") && previousFocus instanceof HTMLElement
        && previousFocus.isConnected && !previousFocus.closest("[hidden],[inert]")) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }
    function reconcile() {
      const anotherDialog = Array.from(document.querySelectorAll("dialog[open]")).some(other => other !== dialog);
      if (!enabled || document.hidden || dialog!.closest("[hidden],[inert]") || anotherDialog) {
        closeForNow(); // Session changes and competing dialogs never acknowledge a badge.
        return;
      }
      if (dialog!.open || !dialog!.isConnected) return;
      previousFocus = returnFocus?.current ?? document.activeElement;
      dialog!.showModal();
      closeRef.current?.focus({ preventScroll: true });
    }
    // React renders, native showModal/close and session hiding are observable;
    // no polling loop or repeating timer is needed while another modal is open.
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "inert"] });
    document.addEventListener("visibilitychange", reconcile);
    reconcile();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", reconcile);
      closeForNow();
    };
  }, [activeKey, enabled, returnFocus]);

  return <dialog ref={dialogRef} id={`${id}-dialog`} className={`${styles.dialog} ${className}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); if (!busy) onDismiss(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onDismiss(); }}>
    {badge ? <><MemberBadgeCard key={badge.key} badge={badge} id={id} preview={preview} celebration={celebration}
      closeControl={<button ref={closeRef} type="button" className={styles.close} aria-label="Close badge details" disabled={busy} onClick={() => { if (!busy) onDismiss(); }}>×</button>} />
      <MemberBadgeDownload badge={badge} />{children}</> : null}
  </dialog>;
}
