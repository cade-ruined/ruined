"use client";

import Image from "next/image";
import { useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import { PRODUCT_TONES, type Product, type ProductImage } from "@/data/products";
import styles from "./ProductSurface.module.css";

export default function ProductGallery({ images, tone, label, compact = false }: {
  images: ProductImage[];
  tone: Product["tone"];
  label: string;
  compact?: boolean;
}) {
  const viewport = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  function showImage(index: number) {
    const element = viewport.current;
    if (!element || !images.length) return;
    const next = Math.max(0, Math.min(images.length - 1, index));
    element.scrollTo({
      left: next * element.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    setActive(next);
  }

  function updatePosition(event: UIEvent<HTMLUListElement>) {
    const element = event.currentTarget;
    if (element.clientWidth > 0) {
      setActive(Math.max(0, Math.min(images.length - 1, Math.round(element.scrollLeft / element.clientWidth))));
    }
  }

  function navigate(event: KeyboardEvent<HTMLUListElement>) {
    // Desktop photographs are stacked and should retain normal page scrolling.
    if (!compact && window.matchMedia("(min-width: 768px)").matches) return;
    const next = event.key === "ArrowRight" ? active + 1
      : event.key === "ArrowLeft" ? active - 1
        : event.key === "Home" ? 0
          : event.key === "End" ? images.length - 1
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    showImage(next);
  }

  return (
    <section className="min-w-0 md:col-span-7" aria-label={label}>
      {images.length ? (
        <ul
          ref={viewport}
          tabIndex={images.length > 1 ? 0 : undefined}
          aria-label="Product images"
          onScroll={updatePosition}
          onKeyDown={navigate}
          className={`${styles.gallery} ${compact ? "" : styles.fullGallery}`}
        >
          {images.map((image, index) => (
            <li key={image.url} className={`relative aspect-[4/5] min-w-0 basis-full shrink-0 snap-start snap-always overflow-hidden ${compact ? styles.compactFrame : ""}`} style={{ background: PRODUCT_TONES[tone] }}>
              <Image src={image.url} alt={image.alt} fill priority={index === 0} sizes={compact ? "(min-width: 1200px) 580px, (min-width: 768px) 55vw, calc(100vw - 40px)" : "(min-width: 1200px) 650px, (min-width: 768px) 58vw, calc(100vw - 40px)"} className={compact ? "object-contain" : "object-cover"} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="aspect-[4/5]" aria-hidden="true" style={{ background: PRODUCT_TONES[tone] }} />
      )}
      {images.length > 1 && (
        <div className={`mt-3 flex items-center justify-between gap-3 pb-1 font-mono text-xs uppercase tracking-[0.1em] ${compact ? "" : "md:hidden"}`}>
          <button type="button" onClick={() => showImage(active - 1)} disabled={active === 0} aria-label="Previous product image" className={`${styles.action} px-3`}>
            <span aria-hidden="true">←</span>
          </button>
          <span aria-live="polite" aria-atomic="true" className="text-black/60">{active + 1} / {images.length}</span>
          <button type="button" onClick={() => showImage(active + 1)} disabled={active === images.length - 1} aria-label="Next product image" className={`${styles.action} px-3`}>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
    </section>
  );
}
