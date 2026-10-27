"use client";

import Image from "next/image";
import { useEffect, useId, useRef } from "react";
import type { ProductSizeGuide } from "@/data/product-size-guides";
import { acquireProductScrollLock } from "@/lib/store/product-scroll-lock";
import styles from "./ProductSurface.module.css";

export default function ProductSizeGuideDialog({
  guide,
  onOpen,
}: {
  guide: ProductSizeGuide;
  onOpen?: () => void;
}) {
  const headingId = useId();
  const dialogId = `${headingId}-dialog`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const chartViewportRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const releaseScrollLock = useRef<(() => void) | null>(null);

  function openGuide() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    releaseScrollLock.current = acquireProductScrollLock();
    try {
      dialog.showModal();
    } catch (error) {
      releaseScrollLock.current();
      releaseScrollLock.current = null;
      throw error;
    }
    onOpen?.();
    requestAnimationFrame(() => {
      const viewport = chartViewportRef.current;
      if (!viewport) return;
      viewport.scrollLeft = guide.fit === "Women's"
        ? viewport.scrollWidth - viewport.clientWidth
        : 0;
    });
  }

  function closeGuide() {
    dialogRef.current?.close();
  }

  function restorePage() {
    const release = releaseScrollLock.current;
    if (!release) return;
    releaseScrollLock.current = null;
    release();
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => () => {
    releaseScrollLock.current?.();
    releaseScrollLock.current = null;
  }, []);

  const visibleHeight = guide.image.height - guide.image.cropTop;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openGuide}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        className={`${styles.action} px-3 font-mono text-xs uppercase tracking-[0.12em]`}
      >
        Size guide
      </button>

      <dialog
        id={dialogId}
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={headingId}
        onClose={restorePage}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) closeGuide();
        }}
        className="fixed inset-0 z-[120] m-0 hidden h-dvh max-h-none w-screen max-w-none grid-rows-[auto_1fr] bg-black p-0 text-white backdrop:bg-black open:grid"
      >
        <header className="flex items-center justify-between gap-5 border-b border-black/20 bg-[var(--color-bone)] px-4 py-3 text-[var(--color-faded)] sm:px-6 sm:py-4">
          <div>
            <h2
              id={headingId}
              className="font-mono text-xs uppercase tracking-[0.2em]"
            >
              BYOB Tank · {guide.label}
            </h2>
            <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-black/65">
              Measurements in inches<span className="sm:hidden"> · Swipe to read</span>
            </p>
          </div>
          <button
            type="button"
            onClick={closeGuide}
            className={`${styles.action} px-3 font-mono text-xs uppercase tracking-[0.14em]`}
          >
            Close
          </button>
        </header>

        <div ref={chartViewportRef} className="min-h-0 overflow-auto p-3 sm:p-6">
          <div className="mx-auto flex min-h-full max-w-[100rem] items-start pt-5 sm:items-center sm:pt-0">
            <div
              className="relative w-[48rem] shrink-0 overflow-hidden sm:w-full"
              style={{ aspectRatio: `${guide.image.width} / ${visibleHeight}` }}
            >
              <Image
                src={guide.image.src}
                alt={guide.image.alt}
                fill
                sizes="(min-width: 640px) 96vw, 48rem"
                className="object-cover object-bottom"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
