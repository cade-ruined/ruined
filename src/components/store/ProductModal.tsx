"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { trackStoreEvent } from "@/lib/analytics/storefront";
import { acquireProductScrollLock } from "@/lib/store/product-scroll-lock";
import surface from "./ProductSurface.module.css";
import styles from "./ProductModal.module.css";

export default function ProductModal({ handle, name, children }: {
  handle: string;
  name: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnFocus = () => previousFocus?.isConnected && previousFocus !== document.body
      ? previousFocus
      : document.querySelector<HTMLElement>(`[data-product-handle="${CSS.escape(handle)}"] a`);
    const releaseScroll = acquireProductScrollLock({ restoreScroll: () => Boolean(returnFocus()) });
    try {
      if (!dialog.open) dialog.showModal();
    } catch (error) {
      releaseScroll();
      throw error;
    }
    closeRef.current?.focus({ preventScroll: true });
    closing.current = false;

    return () => {
      if (dialog.open) dialog.close();
      releaseScroll();
      const target = returnFocus();
      requestAnimationFrame(() => { if (target?.isConnected) target.focus({ preventScroll: true }); });
    };
  }, [handle]);

  function dismiss() {
    if (closing.current) return;
    closing.current = true;
    router.back();
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${expanded ? styles.expanded : ""}`} aria-modal="true" aria-label={name}
      data-lenis-prevent data-cursor-native
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        dismiss();
      }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <span className={styles.label}>Quick view</span>
          <div className={styles.controls}>
            <button type="button" className={`${surface.action} ${styles.expand}`} aria-pressed={expanded} onClick={() => {
              if (!expanded) trackStoreEvent("store_product_expanded", { product_handle: handle, source: "product_modal" });
              setExpanded(!expanded);
            }}>
              {expanded ? "Minimize" : "Expand"} <span aria-hidden="true">{expanded ? "↙" : "↗"}</span>
            </button>
            <button ref={closeRef} type="button" className={`${surface.action} ${styles.close}`} aria-label="Close product" onClick={dismiss}>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
          </div>
        </header>
        <div className={styles.content}>{children}</div>
      </div>
    </dialog>
  );
}
