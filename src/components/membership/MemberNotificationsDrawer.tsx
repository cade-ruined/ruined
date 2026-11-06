"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./MemberNotificationsDrawer.module.css";

export default function MemberNotificationsDrawer({ children, intercepted = false }: {
  children: ReactNode;
  intercepted?: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    closing.current = false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected && !opener.closest("[hidden],[inert]")) opener.focus({ preventScroll: true });
    };
  }, []);

  function close() {
    if (closing.current) return;
    closing.current = true;
    if (intercepted) router.back();
    else router.replace("/my", { scroll: false });
  }

  return <dialog ref={dialogRef} className={styles.drawer} aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={styles.surface}>
      <header className={styles.header}>
        <h2 id={titleId}>Notifications</h2>
        <button ref={closeRef} className={styles.close} type="button" onClick={close}>Close <span aria-hidden="true">×</span></button>
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  </dialog>;
}
