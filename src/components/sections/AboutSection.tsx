"use client";

import { motion } from "motion/react";
import SectionHeader from "./SectionHeader";
import SiblingNav from "@/components/SiblingNav";

const CREDITS: { label: string; value: string }[] = [
  { label: "Est.", value: "RU / MMXXVI" },
  { label: "Studio", value: "No. 17" },
  { label: "Loc.", value: "— / —" },
  { label: "Contact", value: "hello@ruined.studio" },
];

export default function AboutSection() {
  return (
    <section
      id="about"
      aria-label="About"
      className="snap-frame snap-start relative text-[var(--foreground)] flex flex-col"
    >
      {/* signal-amber halo low-right + a barely-there grain — about is the "warm" room */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(42,42,42,0.45) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.10]"
        style={{
          background:
            "radial-gradient(50% 50% at 90% 90%, rgba(229,169,35,0.6) 0%, rgba(229,169,35,0) 60%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-5xl px-6 sm:px-10 pt-6 sm:pt-8 pb-3 flex flex-col flex-1 min-h-0">
        <SectionHeader
          label="ABOUT"
          index="03"
          total="03"
          kicker="——  manifesto"
        />

        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
          className="display text-[clamp(1.85rem,5.5vw,4rem)] leading-[0.95] text-[var(--color-faded)] mb-5 sm:mb-7"
        >
          WHAT REMAINS,
          {" "}
          <span className="italic text-[var(--color-signal)]">remains.</span>
        </motion.h2>

        {/* Manifesto + credits + pull-quote, all inside the frame. The
            wide atelier image lived here before but it's gone now —
            with the frame constrained to viewport-couch, it was the
            obvious cut to keep the rest readable. */}
        <div className="flex-1 min-h-0 flex flex-col justify-center gap-6 sm:gap-8">
          <div className="grid grid-cols-12 gap-x-6 gap-y-6">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.9, ease: "easeOut", delay: 0.1 }}
              className="col-span-12 md:col-span-7 space-y-3 sm:space-y-4 text-sm sm:text-base leading-relaxed text-[var(--color-faded)]/85"
            >
              <p>
                <span className="display text-[var(--color-signal)] mr-1">
                  Ruined
                </span>
                is a studio practice built around what survives — the
                texture, the patina, the parts that remember.
              </p>
              <p className="text-[var(--muted-foreground)]">
                We work in small numbers, by hand, mostly in silence — and
                release drops without warning, numbered and dated.
              </p>
            </motion.div>

            <motion.dl
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.9, ease: "easeOut", delay: 0.2 }}
              className="col-span-12 md:col-span-4 md:col-start-9 md:pl-5 md:border-l md:border-[var(--border)] space-y-2.5"
            >
              {CREDITS.map((c) => (
                <div
                  key={c.label}
                  className="grid grid-cols-3 gap-2 font-mono text-[0.65rem] tracking-[0.18em] uppercase"
                >
                  <dt className="col-span-1 text-[var(--muted-foreground)]">
                    {c.label}
                  </dt>
                  <dd className="col-span-2 text-[var(--color-faded)]">
                    {c.value}
                  </dd>
                </div>
              ))}
            </motion.dl>
          </div>

          <motion.blockquote
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
            className="display max-w-3xl italic text-[clamp(1.1rem,2.6vw,1.8rem)] leading-snug text-[var(--color-faded)]"
          >
            &ldquo;Nothing here is finished. Nothing here is meant to be.&rdquo;
          </motion.blockquote>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.55 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.0, ease: "easeOut" }}
          className="mt-3 flex flex-wrap items-center justify-between gap-3 font-mono text-[0.65rem] tracking-[0.4em] uppercase text-[var(--muted-foreground)]"
        >
          <span>RU / MMXXVI</span>
          <SiblingNav />
          <span>— end —</span>
        </motion.div>
      </div>
    </section>
  );
}
