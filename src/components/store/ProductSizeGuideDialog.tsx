"use client";

import Image from "next/image";
import { useEffect, useId, useRef } from "react";
import type { ProductSizeGuide } from "@/data/product-size-guides";

export default function ProductSizeGuideDialog({
  guide,
}: {
  guide: ProductSizeGuide;
}) {
  const headingId = useId();
  const dialogId = `${headingId}-dialog`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const chartViewportRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousOverflowRef = useRef("");

  function openGuide() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
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
    document.body.style.overflow = previousOverflowRef.current;
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => () => {
    document.body.style.overflow = previousOverflowRef.current;
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
        className="min-h-11 text-left font-mono text-[0.58rem] uppercase tracking-[0.18em] text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-[var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
        <header className="flex items-center justify-between gap-5 border-b border-white/20 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <h2
              id={headingId}
              className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-white"
            >
              BYOB Tank · {guide.label}
            </h2>
            <p className="mt-1 font-mono text-[0.52rem] uppercase tracking-[0.16em] text-white/45">
              Measurements in inches<span className="sm:hidden"> · Swipe to read</span>
            </p>
          </div>
          <button
            type="button"
            onClick={closeGuide}
            className="min-h-11 border border-white/35 px-3 font-mono text-[0.58rem] uppercase tracking-[0.14em] transition-colors hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
                priority
              />
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
