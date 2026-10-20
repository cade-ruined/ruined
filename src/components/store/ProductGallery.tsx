"use client";

import Image from "next/image";
import { useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import { PRODUCT_TONES, type Product, type ProductImage } from "@/data/products";

export default function ProductGallery({ images, tone, label }: {
  images: ProductImage[];
  tone: Product["tone"];
  label: string;
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
    if (window.matchMedia("(min-width: 768px)").matches) return;
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
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white md:grid md:snap-none md:gap-5 md:overflow-visible [&::-webkit-scrollbar]:hidden"
        >
          {images.map((image, index) => (
            <li key={image.url} className="relative aspect-[4/5] min-w-0 basis-full shrink-0 snap-start snap-always overflow-hidden" style={{ background: PRODUCT_TONES[tone] }}>
              <Image src={image.url} alt={image.alt} fill priority={index === 0} sizes="(min-width: 1200px) 650px, (min-width: 768px) 58vw, calc(100vw - 40px)" className="object-cover" />
            </li>
          ))}
        </ul>
      ) : (
        <div className="aspect-[4/5]" aria-hidden="true" style={{ background: PRODUCT_TONES[tone] }} />
      )}
      {images.length > 1 && (
        <div className="flex items-center justify-between border-b border-white/15 font-mono text-[0.58rem] uppercase tracking-[0.18em] md:hidden">
          <button type="button" onClick={() => showImage(active - 1)} disabled={active === 0} aria-label="Previous product image" className="min-h-11 min-w-11 pr-3 text-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:text-white/25">
            ← Previous
          </button>
          <span aria-live="polite" aria-atomic="true" className="text-white/55">{active + 1} / {images.length}</span>
          <button type="button" onClick={() => showImage(active + 1)} disabled={active === images.length - 1} aria-label="Next product image" className="min-h-11 min-w-11 pl-3 text-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:text-white/25">
            Next →
          </button>
        </div>
      )}
    </section>
  );
}
