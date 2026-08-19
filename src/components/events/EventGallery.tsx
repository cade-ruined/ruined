"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { EventGalleryImage } from "@/data/eventGalleries";

export default function EventGallery({
  eventId,
  eventTitle,
  images,
}: {
  eventId: string;
  eventTitle: string;
  images: readonly EventGalleryImage[];
}) {
  const headingId = `${eventId}-gallery-heading`;
  const lightboxHeadingId = `${eventId}-lightbox-heading`;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement>(null);
  const activeImage = activeIndex === null ? null : images[activeIndex];

  function closeLightbox() {
    dialogRef.current?.close();
  }

  function handleDialogClose() {
    setActiveIndex(null);
    requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }

  useEffect(() => {
    if (!activeImage) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dialog.close();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeImage]);

  return (
    <section
      id={`${eventId}-gallery`}
      aria-labelledby={headingId}
      className="bg-[var(--color-bone)] px-4 pb-20 pt-12 text-[var(--color-faded)] sm:px-8 sm:pb-28 sm:pt-16"
    >
      <div className="mx-auto max-w-[96rem]">
        <header className="grid gap-5 border-b border-black/25 pb-6 sm:grid-cols-[1fr_auto] sm:items-end sm:pb-8">
          <div>
            <p className="ui-heading text-[0.62rem] uppercase tracking-[0.14em] text-[var(--color-poster)]">
              Event archive
            </p>
            <h2
              id={headingId}
              className="display mt-2 text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.84]"
            >
              {eventTitle} photographs.
            </h2>
          </div>
          <p className="ui-heading text-[0.62rem] uppercase tracking-[0.14em] text-black/50">
            {String(images.length).padStart(2, "0")} images
          </p>
        </header>

        <ol
          aria-label={`${eventTitle} photo gallery`}
          className="mt-4 columns-2 gap-2 sm:columns-3 sm:gap-3 lg:columns-4 lg:gap-4"
        >
          {images.map((image, index) => (
            <li
              key={image.src}
              className="mb-2 break-inside-avoid sm:mb-3 lg:mb-4"
            >
              <figure className="bg-black text-white">
                <button
                  type="button"
                  onClick={(clickEvent) => {
                    lastTriggerRef.current = clickEvent.currentTarget;
                    setActiveIndex(index);
                  }}
                  aria-label={`Expand photograph ${index + 1}: ${image.alt}`}
                  className="group/image relative block w-full cursor-zoom-in overflow-hidden text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-signal)]"
                >
                  <Image
                    src={image.src}
                    width={image.width}
                    height={image.height}
                    alt={image.alt}
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    className="h-auto w-full transition-opacity group-hover/image:opacity-90"
                  />
                  <span className="ui-heading absolute right-2 top-2 bg-black/75 px-1.5 py-1 text-[0.48rem] uppercase tracking-[0.1em] opacity-100 transition-opacity sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-visible/image:opacity-100">
                    Expand
                  </span>
                </button>
                {image.credit ? (
                  <figcaption className="border-t border-white/20 px-2 py-2 sm:px-3 sm:py-3">
                    <span className="font-sans text-[0.52rem] leading-tight text-white/65 sm:text-[0.65rem]">
                      {image.credit}
                    </span>
                  </figcaption>
                ) : null}
              </figure>
            </li>
          ))}
        </ol>
      </div>

      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={lightboxHeadingId}
        onClose={handleDialogClose}
        className="fixed inset-0 z-[100] m-0 hidden h-dvh max-h-none w-screen max-w-none flex-col bg-black/95 p-3 text-white backdrop:bg-black/95 open:flex sm:p-6"
        onPointerDown={(pointerEvent) => {
          if (pointerEvent.target === pointerEvent.currentTarget) {
            closeLightbox();
          }
        }}
      >
        {activeImage && activeIndex !== null ? (
          <>
            <header className="flex shrink-0 items-center justify-between gap-5 border-b border-white/25 pb-3">
              <h3
                id={lightboxHeadingId}
                className="ui-heading text-[0.58rem] uppercase tracking-[0.13em] text-white/70"
              >
                {activeImage.label} ·{" "}
                {String(activeIndex + 1).padStart(2, "0")} /{" "}
                {String(images.length).padStart(2, "0")}
              </h3>
              <button
                type="button"
                onClick={closeLightbox}
                className="ui-heading border border-white/35 px-3 py-2 text-[0.58rem] uppercase tracking-[0.12em] outline-none hover:bg-white hover:text-black focus-visible:ring-2 focus-visible:ring-[var(--color-signal)]"
              >
                Close
              </button>
            </header>

            <div className="relative my-3 min-h-0 flex-1 sm:my-5">
              <Image
                src={activeImage.src}
                alt={activeImage.alt}
                fill
                sizes="100vw"
                className="object-contain"
                priority
              />
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/25 pt-3">
              {activeImage.credit ? (
                <p className="font-sans text-[0.68rem] text-white/65">
                  {activeImage.credit}
                </p>
              ) : (
                <span aria-hidden="true" />
              )}
              <div className="flex items-center gap-2">
                <a
                  href={activeImage.src}
                  target="_blank"
                  rel="noreferrer"
                  className="ui-heading border border-white/35 px-3 py-2 text-[0.58rem] uppercase tracking-[0.12em] outline-none hover:bg-white hover:text-black focus-visible:ring-2 focus-visible:ring-[var(--color-signal)]"
                >
                  Open original
                </a>
                <a
                  href={activeImage.src}
                  download={activeImage.src.split("/").pop()?.split("?")[0]}
                  className="ui-heading bg-white px-3 py-2 text-[0.58rem] uppercase tracking-[0.12em] text-black outline-none hover:bg-[var(--color-signal)] focus-visible:ring-2 focus-visible:ring-[var(--color-signal)]"
                >
                  Save image
                </a>
              </div>
            </footer>
          </>
        ) : null}
      </dialog>
    </section>
  );
}
