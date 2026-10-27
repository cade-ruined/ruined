"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./StoreFilterDrawer.module.css";

type StoreFilterDrawerProps = {
  children: ReactNode;
  activeCount: number;
  hasFilters: boolean;
  resultCount: number;
  onClear: () => void;
};

export default function StoreFilterDrawer({
  children,
  activeCount,
  hasFilters,
  resultCount,
  onClear,
}: StoreFilterDrawerProps) {
  const headingId = useId();
  const dialogId = `${headingId}-dialog`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const releaseScrollRef = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);

  function releaseScroll() {
    releaseScrollRef.current?.();
    releaseScrollRef.current = null;
  }

  function openDrawer() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;

    const body = document.body;
    const previous = {
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      width: body.style.width,
    };
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const fixedBody = window.matchMedia("(pointer: coarse)").matches;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${parseFloat(window.getComputedStyle(body).paddingRight || "0") + scrollbarWidth}px`;
    }
    body.style.overflow = "hidden";
    if (fixedBody) {
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.left = `-${scrollX}px`;
      body.style.width = "100%";
    }
    releaseScrollRef.current = () => {
      Object.assign(body.style, previous);
      if (fixedBody) window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    };

    try {
      dialog.showModal();
      setOpen(true);
      closeRef.current?.focus({ preventScroll: true });
    } catch (error) {
      releaseScroll();
      throw error;
    }
  }

  function closeDrawer() {
    dialogRef.current?.close();
  }

  function restorePage() {
    releaseScroll();
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => () => {
    releaseScrollRef.current?.();
    releaseScrollRef.current = null;
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={openDrawer}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-expanded={open}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 6h3m4 0h7M8 3v6M3 14h9m4 0h1M14 11v6" stroke="currentColor" strokeWidth="1.25" />
        </svg>
        Filters{activeCount > 0 && <span className={styles.count}>({activeCount})</span>}
      </button>

      <dialog
        id={dialogId}
        ref={dialogRef}
        className={styles.dialog}
        aria-modal="true"
        aria-labelledby={headingId}
        data-lenis-prevent
        data-cursor-native
        onClose={restorePage}
        onCancel={(event) => { event.preventDefault(); closeDrawer(); }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = panelRef.current?.getBoundingClientRect();
          if (bounds && (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom)) {
            closeDrawer();
          }
        }}
      >
        <div ref={panelRef} className={styles.panel}>
          <header className={styles.header}>
            <h2 id={headingId}>Filters</h2>
            <button ref={closeRef} type="button" className={styles.close} onClick={closeDrawer} aria-label="Close filters">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </header>
          <div className={styles.content}>{children}</div>
          <footer className={styles.footer}>
            <button type="button" className={styles.clear} disabled={!hasFilters} onClick={onClear}>Clear filters</button>
            <button type="button" className={styles.view} onClick={closeDrawer}>
              View {resultCount} {resultCount === 1 ? "style" : "styles"}
              <span aria-hidden="true">↗</span>
            </button>
          </footer>
        </div>
      </dialog>
    </>
  );
}
