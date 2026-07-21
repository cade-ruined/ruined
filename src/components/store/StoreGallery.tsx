"use client";

import Link from "next/link";
import { motion } from "motion/react";
import Image from "next/image";
import type { Product } from "@/data/products";
import ProductPlate from "./ProductPlate";
import SiblingNav from "@/components/SiblingNav";

/**
 * Full-store catalogue at /store — an editorial gallery of every product
 * in the current drop, presented like a museum/exhibition catalogue
 * (numbered plates, wall-text metadata, generous negative space).
 *
 * The page is built around the same color register as the home Store
 * preview (bg-black with poster-red accents) so the transition from
 * preview → full archive reads as one continuous experience, just with
 * deeper inventory and a calmer, browseable pace.
 */
export default function StoreGallery({ products }: { products: Product[] }) {
  const total = products.length;

  return (
    <main className="relative min-h-screen bg-black text-[var(--color-bone)]">
      {/* Ambient overlays — same vocabulary as the home Store section */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(229,224,213,0.5) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.12]"
        style={{
          background:
            "radial-gradient(60% 50% at 80% 15%, rgba(208,49,45,0.55) 0%, rgba(208,49,45,0) 60%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        <Header total={total} />

        <section aria-label="Quick catalogue" className="border-t border-white/15 bg-black px-6 py-10 text-[var(--color-bone)] sm:px-10 sm:py-14">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div><p className="font-mono text-[0.58rem] uppercase tracking-[0.32em] text-[var(--color-poster)]">Quick index</p><h2 className="display mt-2 text-3xl">The complete drop.</h2></div>
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.25em] text-white/40">Select to inspect</span>
          </div>
          <div className="grid grid-cols-2 gap-px bg-white/15 md:grid-cols-4">
            {products.map((product, index) => (
              <Link key={product.id} href={`/store/${product.id}`} className="group bg-black p-3 transition-colors hover:bg-white/[0.06] sm:p-4">
                <div className="relative aspect-[4/5] overflow-hidden" style={{ background: `var(--color-${product.tone === "warm" ? "signal" : product.tone === "shadow" ? "faded" : "verdigris"})` }}>
                  {product.image && <Image src={product.image.url} alt={product.image.alt} fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.03]" />}
                  <span className="absolute left-2 top-2 font-mono text-[0.5rem] tracking-[0.2em] text-white/70">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="mt-3 flex items-start justify-between gap-2"><div><h3 className="text-sm tracking-normal">{product.name}</h3><p className="mt-1 font-mono text-[0.5rem] uppercase tracking-[0.18em] text-white/45">{product.available === false ? "Sold out" : product.variantId ? "Available" : "Enquire"}</p></div><span className="display text-lg">{product.price}</span></div>
              </Link>
            ))}
          </div>
        </section>

        <section
          aria-label="Drop catalogue"
          className="text-[var(--color-faded)]"
          // The plates surface bg flips to bone here — same register as
          // the Work/About sections of the home, so the catalogue feels
          // like an editorial broadsheet pulled out from the dark Store
          // teaser, not a continuation of the same black slab.
          style={{
            background: "var(--color-surface)",
            color: "var(--color-faded)",
          }}
        >
          {products.map((product, i) => (
            <ProductPlate
              key={product.id}
              product={product}
              index={i}
              total={total}
            />
          ))}
        </section>

        <Footer total={total} />
      </div>
    </main>
  );
}

function Header({ total }: { total: number }) {
  return (
    <header className="relative px-6 sm:px-10 pt-16 sm:pt-24 pb-12 sm:pb-16 text-[var(--color-bone)]">
      {/* Breadcrumb / location stamp */}
      <div className="flex items-baseline justify-between font-mono text-[0.62rem] sm:text-[0.7rem] tracking-[0.4em] uppercase text-[var(--color-bone)]/55">
        <Link
          href="/#store"
          className="hover:text-[var(--color-bone)] transition-colors duration-200"
        >
          ← Back
        </Link>
        <span>
          Store{" "}
          <span className="text-[var(--color-bone)]/30 mx-2">·</span>{" "}
          Drop 01 / SS26
        </span>
      </div>

      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
        className="display text-[clamp(3rem,11vw,9rem)] leading-[0.92] mt-12 sm:mt-16 text-[var(--color-bone)]"
      >
        ART<span className="italic text-[var(--color-poster)]">I</span>FACTS
      </motion.h1>

      <div className="mt-8 sm:mt-12 grid grid-cols-12 gap-x-6 sm:gap-x-10 gap-y-6">
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: "easeOut", delay: 0.25 }}
          className="col-span-12 md:col-span-7 text-base sm:text-lg leading-relaxed text-[var(--color-bone)]/85 max-w-prose"
        >
          The first drop. Four pieces, hand-finished, made in small numbers —
          each one numbered, dated, and meant to age with you. Browse the full
          archive below; tap{" "}
          <span className="font-mono text-[0.85em] tracking-[0.18em] uppercase text-[var(--color-poster)]">
            Enquire
          </span>{" "}
          on any plate to begin.
        </motion.p>

        <motion.dl
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: "easeOut", delay: 0.35 }}
          className="col-span-12 md:col-span-4 md:col-start-9 md:pl-6 md:border-l md:border-[var(--color-bone)]/15 space-y-3 font-mono text-[0.65rem] sm:text-[0.7rem] tracking-[0.32em] uppercase"
        >
          <DropMeta label="Drop" value="01" />
          <DropMeta label="Season" value="SS / MMXXVI" />
          <DropMeta label="Pieces" value={String(total).padStart(2, "0")} />
          <DropMeta label="Pace" value="Without warning" />
        </motion.dl>
      </div>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
        className="origin-left h-px bg-[var(--color-bone)]/15 mt-12 sm:mt-16"
      />
    </header>
  );
}

function DropMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <dt className="col-span-1 text-[var(--color-bone)]/50">{label}</dt>
      <dd className="col-span-2 text-[var(--color-bone)]">{value}</dd>
    </div>
  );
}

function Footer({ total }: { total: number }) {
  return (
    <footer className="relative bg-black px-6 sm:px-10 py-16 sm:py-24 text-[var(--color-bone)]/55 font-mono text-[0.65rem] tracking-[0.4em] uppercase">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <span>—— end of drop 01 ——</span>
        <span>{String(total).padStart(2, "0")} pieces</span>
      </div>

      <div className="mt-8 sm:mt-12 flex items-center justify-between flex-wrap gap-4 pt-6 border-t border-[var(--color-bone)]/15">
        <Link
          href="/"
          className="inline-flex items-center gap-2 hover:text-[var(--color-bone)] transition-colors duration-200"
        >
          <span aria-hidden>←</span>
          <span>Return home</span>
        </Link>
        <SiblingNav />
      </div>

      {/* Bottom padding so the last row clears the couch menu */}
      <div
        aria-hidden
        style={{
          height: "calc(var(--bottom-menu-h, 190px) + env(safe-area-inset-bottom, 0px))",
        }}
      />
    </footer>
  );
}
