"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

type Tone = "light" | "dark";

type Props = {
  label: string;
  index: string;
  total: string;
  kicker?: string;
  /** "light" = on cream backgrounds (default); "dark" = on the hero-black backdrop. */
  tone?: Tone;
  /**
   * Optional right-side slot on the top header line. When provided, replaces
   * the default "Nº 01 / 03" stamp — sections that have a "go deeper" action
   * (e.g. Store's All Artifacts → /store) render the action here so it lives
   * spatially adjacent to the section label.
   */
  action?: ReactNode;
};

/**
 * Industrial editorial section header in the spirit of Off-White
 * (bracket-quoted label) and S'envoler ("Nº" numbering, gold rule).
 *
 * tone="dark" swaps in bone-on-black inks for the store register where
 * the section sits on the hero's black tail.
 */
export default function SectionHeader({
  label,
  index,
  total,
  kicker,
  tone = "light",
  action,
}: Props) {
  const muted =
    tone === "dark"
      ? "text-[var(--color-bone)]/55"
      : "text-[var(--muted-foreground)]";
  const accent =
    tone === "dark"
      ? "text-[var(--color-poster)]"
      : "text-[var(--primary)]";
  const rule =
    tone === "dark" ? "bg-[var(--color-bone)]/20" : "bg-[var(--border)]";

  return (
    <motion.header
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="mb-12 sm:mb-16"
    >
      <div
        className={`ui-heading flex items-center justify-between gap-6 text-[0.7rem] sm:text-xs tracking-[0.22em] uppercase ${muted}`}
      >
        <span className={accent}>
          <span aria-hidden>「&nbsp;</span>
          {label}
          <span aria-hidden>&nbsp;」</span>
        </span>

        {action ?? (
          <span className="hidden sm:inline tabular-nums">
            Nº&nbsp;{index}&nbsp;/&nbsp;{total}
          </span>
        )}
      </div>

      <motion.div
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        className={`mt-4 h-px w-full origin-left ${rule}`}
      />

      {kicker && (
        <p
          className={`mt-6 max-w-xl text-[0.7rem] font-medium sm:text-xs tracking-[0.16em] uppercase ${muted}`}
        >
          {kicker}
        </p>
      )}
    </motion.header>
  );
}
