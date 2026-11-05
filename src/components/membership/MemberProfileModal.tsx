"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, type ReactNode } from "react";
import journeyStyles from "./MemberJourneyShell.module.css";
import styles from "./MemberProfileModal.module.css";

export default function MemberProfileModal({ children, profileHref }: { children: ReactNode; profileHref: string }) {
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closing = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    closing.current = false;
    if (!previousFocus.current) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    const frame = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      if (dialog.open) dialog.close();
      document.body.style.overflow = overflow;
      const opener = previousFocus.current;
      requestAnimationFrame(() => {
        const target = opener?.isConnected && opener !== document.body ? opener
          : document.querySelector<HTMLElement>('button[aria-label="Search members and pages"]');
        target?.focus({ preventScroll: true });
      });
    };
  }, []);

  function close() {
    if (closing.current) return;
    closing.current = true;
    router.back();
  }

  return <dialog ref={dialogRef} className={`${journeyStyles.journey} ${styles.dialog}`} data-member-journey data-member-theme="paper"
    data-member-profile-dialog="true" aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={styles.surface}>
      <header className={styles.header}>
        <h2 id={titleId}>Member profile</h2>
        <div className={styles.actions}>
          <a href={profileHref} className={styles.expand} aria-label="Open full profile page">Open page <span aria-hidden="true">↗</span></a>
          <button ref={closeRef} type="button" className={styles.close} onClick={close}>Close <span aria-hidden="true">×</span></button>
        </div>
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  </dialog>;
}
