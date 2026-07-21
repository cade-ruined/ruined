"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { useRef } from "react";
import Image from "next/image";
import type { Product } from "@/data/products";
import { PRODUCT_TONES } from "@/data/products";
import { checkout } from "@/lib/store-actions";

type Props = {
  product: Product;
  index: number; // 0-based — drives the plate number and alternating layout
  total: number; // total plates in the gallery (for "Nº 01 / 04" style stamps)
};

// Shared CTA styling for the Acquire/Enquire affordances.
const ctaClass =
  "group inline-flex items-center gap-2 font-mono text-[0.65rem] sm:text-[0.7rem] tracking-[0.4em] uppercase text-[var(--color-faded)] hover:text-[var(--color-poster)] transition-colors duration-300";

/**
 * A single product "plate" in the full-store gallery — modeled on museum
 * exhibition catalogues. Each plate is a full-width spread with:
 *
 *   • numbered title slug (Nº 001 + product code)
 *   • large gradient-tone art surface that parallaxes slowly on scroll
 *   • metadata sidebar: name, subtitle, description, specs, price/CTA
 *   • alternating left/right image position to give the list visual rhythm
 *
 * On mobile the columns stack (art on top, metadata below) — the alternating
 * rhythm reads via the kicker alignment instead.
 */
export default function ProductPlate({ product, index, total }: Props) {
  const ref = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();

  // Slow parallax on the art surface — the image drifts opposite to scroll
  // so each plate feels like a held tableau the user is panning past, not
  // a flat tile. Disabled for reduced-motion users.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const artY = useTransform(
    scrollYProgress,
    [0, 1],
    prefersReducedMotion ? ["0%", "0%"] : ["-6%", "6%"]
  );

  const flipped = index % 2 === 1;
  const plateNumber = String(index + 1).padStart(3, "0");
  const totalNumber = String(total).padStart(2, "0");
  const enquiryEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "studio@ruined.studio";
  const enquiryHref = `mailto:${enquiryEmail}?subject=${encodeURIComponent(`Enquiry · ${product.name}`)}`;

  return (
    <motion.article
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
      className="relative border-t border-[var(--color-faded)]/15"
    >
      {/* Plate slug — top stamp with number, code, and total */}
      <header className="flex items-baseline justify-between px-6 sm:px-10 pt-10 sm:pt-16 pb-6 sm:pb-8 font-mono text-[0.65rem] sm:text-[0.7rem] tracking-[0.4em] uppercase">
        <span className="text-[var(--color-poster)]">
          Nº&nbsp;{plateNumber}
        </span>
        <span className="text-[var(--muted-foreground)] tabular-nums">
          {product.code}
        </span>
        <span className="text-[var(--muted-foreground)] tabular-nums hidden sm:inline">
          {plateNumber} / {totalNumber}
        </span>
      </header>

      <div
        className={`grid grid-cols-12 gap-x-6 sm:gap-x-10 gap-y-8 px-6 sm:px-10 pb-16 sm:pb-24 ${
          flipped ? "md:[direction:rtl]" : ""
        }`}
      >
        {/* Art surface — large 4:5 portrait. Inner div is over-tall and
            slow-parallaxes so the gradient drifts as the user scrolls. */}
        <div className="col-span-12 md:col-span-7 [direction:ltr]">
          <div className="relative w-full overflow-hidden rounded-sm bg-black">
            <div
              className="relative w-full"
              style={{ aspectRatio: "4 / 5" }}
            >
              <motion.div
                aria-hidden
                className="absolute inset-x-0 -top-[10%] -bottom-[10%]"
                style={{
                  background: PRODUCT_TONES[product.tone],
                  y: artY,
                }}
              />

              {/* Real product photography (Shopify featuredImage) drifts on the
                  same slow parallax as the tone backdrop; the gradient shows
                  through while it loads and on products without a photo. */}
              {product.image && (
                <motion.div
                  className="absolute inset-x-0 -top-[10%] -bottom-[10%] h-[120%] w-full object-cover"
                  style={{ y: artY }}
                >
                  <Image
                    src={product.image.url}
                    alt={product.image.alt}
                    fill
                    sizes="(min-width: 768px) 58vw, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              )}

              {/* Faint pinstripes baked into the art so it doesn't read
                  as a flat gradient — same texture vocabulary as Store
                  section background. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.06]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg, rgba(229,224,213,0.6) 0 1px, transparent 1px 96px)",
                }}
              />

              {/* Diagonal poster-red glaze, low-intensity — picks up the
                  brand's drop register on every plate. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.18]"
                style={{
                  background:
                    "radial-gradient(60% 50% at 70% 20%, rgba(208,49,45,0.55) 0%, rgba(208,49,45,0) 60%)",
                }}
              />

              {/* Centered product code — reads as a wall-text caption */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="font-mono text-[0.6rem] sm:text-[0.7rem] tracking-[0.5em] uppercase text-[var(--color-bone)]/30">
                  [ {product.name} ]
                </span>
              </div>

              {/* Bottom-right inscription — code repeated as a small mark */}
              <div className="absolute right-3 sm:right-5 bottom-3 sm:bottom-5 font-mono text-[0.55rem] sm:text-[0.6rem] tracking-[0.32em] uppercase text-[var(--color-bone)]/35">
                {product.code}
              </div>
            </div>
          </div>
        </div>

        {/* Metadata sidebar — exhibition wall-text */}
        <div className="col-span-12 md:col-span-5 [direction:ltr] flex flex-col">
          <p className="font-mono text-[0.62rem] tracking-[0.4em] uppercase text-[var(--color-verdigris)] mb-3">
            {product.subtitle}
          </p>

          <h2 className="display text-[clamp(2rem,5vw,3.5rem)] leading-[0.95] text-[var(--color-faded)]">
            {product.name}
          </h2>

          <p className="mt-5 text-sm sm:text-base leading-relaxed text-[var(--color-faded)]/85 max-w-prose">
            {product.description}
          </p>

          {/* Specs — three-row exhibition info card */}
          <dl className="mt-7 sm:mt-8 grid grid-cols-12 gap-y-3 border-t border-[var(--border)] pt-5">
            <SpecRow label="Material" value={product.material} />
            <SpecRow label="Origin" value={product.origin} />
            <SpecRow label="Care" value={product.care} />
          </dl>

          {/* Price + acquire row. When the product is a live Shopify variant,
              the CTA posts to the checkout server action (real cart → Shopify
              hosted checkout); otherwise it degrades to the Enquire affordance.
              A sold-out variant shows a disabled state. */}
          <div className="mt-8 sm:mt-10 flex items-center justify-between gap-4 pt-5 border-t border-[var(--border)]">
            <span className="display text-2xl sm:text-3xl text-[var(--color-faded)] tabular-nums">
              {product.price}
            </span>
            {product.variantId ? (
              product.available === false ? (
                <span className="font-mono text-[0.65rem] sm:text-[0.7rem] tracking-[0.4em] uppercase text-[var(--muted-foreground)]">
                  Sold out
                </span>
              ) : (
                <form action={checkout}>
                  <input type="hidden" name="variantId" value={product.variantId} />
                  <button type="submit" className={ctaClass}>
                    <span>Acquire</span>
                    <span
                      aria-hidden
                      className="inline-block h-px w-8 sm:w-10 bg-current group-hover:w-12 sm:group-hover:w-14 transition-[width] duration-300"
                    />
                    <span aria-hidden>→</span>
                  </button>
                </form>
              )
            ) : (
              <a href={enquiryHref} className={ctaClass}>
                <span>Enquire</span>
                <span
                  aria-hidden
                  className="inline-block h-px w-8 sm:w-10 bg-current group-hover:w-12 sm:group-hover:w-14 transition-[width] duration-300"
                />
                <span aria-hidden>→</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="col-span-4 font-mono text-[0.62rem] sm:text-[0.65rem] tracking-[0.32em] uppercase text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="col-span-8 text-sm sm:text-[0.95rem] text-[var(--color-faded)] leading-snug">
        {value}
      </dd>
    </>
  );
}
