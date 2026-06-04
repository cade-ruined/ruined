"use client";

import Link from "next/link";
import { motion } from "motion/react";
import SectionHeader from "./SectionHeader";
import ProductStack from "./ProductStack";
import { PRODUCTS } from "@/data/products";

export default function StoreSection() {
  return (
    <section
      id="store"
      aria-label="Store"
      // First post-hero snap target. The section is a full-viewport
      // .snap-frame so its bg-black paints behind the couch, and
      // snap-start lets proximity snap pull the user in once they
      // reach hero's end. No negative margin — Store's top sits
      // exactly at hero's end so the snap point doesn't bleed into
      // the hero parallax and fight it.
      className="snap-frame snap-start relative z-10 bg-black text-[var(--color-bone)] flex flex-col"
    >
      {/* Faint grain — keeps the void from reading as a flat black tile */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(229,224,213,0.5) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />

      {/* Poster-red ambient wash — store is the "drop" register */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          background:
            "radial-gradient(55% 45% at 78% 18%, rgba(208,49,45,0.75) 0%, rgba(208,49,45,0) 60%)",
        }}
      />

      {/* Vertical pinstripes — barely there, gives the dark some texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(229,224,213,0.5) 0 1px, transparent 1px 120px)",
        }}
      />

      {/* Inner column fills the frame and is sized via the section's
          flex layout. SectionHeader + title sit at the top, ProductStack
          grows to fill the middle, end stamp pins to the bottom. */}
      <div className="relative mx-auto w-full max-w-5xl px-6 sm:px-10 pt-6 sm:pt-8 pb-3 flex flex-col flex-1 min-h-0">
        <SectionHeader
          label="STORE"
          index="01"
          total="03"
          kicker="——  drop 01  /  ss26"
          tone="dark"
          action={
            <Link
              href="/store"
              className="group inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 border border-[var(--color-bone)]/40 hover:border-[var(--color-bone)] hover:bg-[var(--color-bone)] hover:text-black font-mono text-[0.58rem] sm:text-[0.62rem] tracking-[0.32em] uppercase text-[var(--color-bone)]/85 transition-colors duration-300"
            >
              <span>All Artifacts</span>
              <span
                aria-hidden
                className="inline-block transition-transform duration-300 group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          }
        />

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
          className="display text-[clamp(2rem,6vw,4.25rem)] leading-[0.95] text-[var(--color-bone)] mb-4 sm:mb-6"
        >
          ART<span className="italic text-[var(--color-poster)]">I</span>FACTS
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="flex-1 min-h-0 flex items-center justify-center"
        >
          <ProductStack products={PRODUCTS} />
        </motion.div>

      </div>

    </section>
  );
}
