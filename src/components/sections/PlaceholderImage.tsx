"use client";

import { motion } from "motion/react";

type Tone = "warm" | "shadow" | "atelier";

type Props = {
  /** Aspect ratio in CSS form, e.g. "16/9", "4/5", "1/1". */
  ratio?: string;
  /** Top-left mono label (e.g. "LOOKBOOK · 01"). */
  label?: string;
  /** Bottom-right mono caption (e.g. "RU/SS26"). */
  caption?: string;
  /** Color palette of the gradient backdrop. */
  tone?: Tone;
  /** Optional className for the figure. */
  className?: string;
  /** Animate-in delay (seconds). */
  delay?: number;
};

const TONES: Record<Tone, string> = {
  // Warm umber / dusk — for lookbook hero shots.
  warm: "linear-gradient(135deg, #1c1108 0%, #3a2615 35%, #1d1410 70%, #0a0707 100%)",
  // Near-black with subtle warmth — for product flats / archive plates.
  shadow: "linear-gradient(160deg, #0a0908 0%, #181513 50%, #0a0807 100%)",
  // Soft warm grey — for atelier portraits, slightly lifted in the mids.
  atelier:
    "linear-gradient(120deg, #14110e 0%, #2c2419 35%, #1a1612 65%, #0a0807 100%)",
};

/**
 * Editorial-style placeholder image. Renders a dark gradient block with
 * corner crop marks, faint scan lines, and mono labels so the placement
 * reads like a contact-sheet proof — useful while real photography is
 * still in production.
 */
export default function PlaceholderImage({
  ratio = "16/9",
  label,
  caption,
  tone = "warm",
  className,
  delay = 0,
}: Props) {
  return (
    <motion.figure
      initial={{ opacity: 0, scale: 0.97 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{
        duration: 1.0,
        ease: [0.22, 1, 0.36, 1],
        delay,
      }}
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{
        aspectRatio: ratio,
        background: TONES[tone],
        // hairline bone border so the plate has a defined edge on cream
        boxShadow: "inset 0 0 0 1px rgba(229,224,213,0.18)",
      }}
    >
      {/* faint horizontal "louver light" — architectural texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(229,224,213,0.55) 0 1px, transparent 1px 72px)",
        }}
      />

      {/* very faint dust grain */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(229,224,213,0.45) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />

      {/* four bone crop marks — neutral, like print-shop registration */}
      <CropMark position="tl" />
      <CropMark position="tr" />
      <CropMark position="bl" />
      <CropMark position="br" />

      {/* centered placeholder marker */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-[0.62rem] tracking-[0.45em] uppercase text-[var(--color-bone)]/35">
          [&nbsp;image&nbsp;]
        </span>
      </div>

      {label && (
        <figcaption className="absolute top-3 left-3 font-mono text-[0.62rem] tracking-[0.32em] uppercase text-[var(--color-bone)]/70">
          {label}
        </figcaption>
      )}

      {caption && (
        <figcaption className="absolute bottom-3 right-3 font-mono text-[0.62rem] tracking-[0.32em] uppercase text-[var(--color-bone)]/70">
          {caption}
        </figcaption>
      )}
    </motion.figure>
  );
}

type CropPosition = "tl" | "tr" | "bl" | "br";

type CropSpec = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
};

const CROP_MAP: Record<CropPosition, CropSpec> = {
  tl: { top: 8, left: 8, borderTop: true, borderLeft: true },
  tr: { top: 8, right: 8, borderTop: true, borderRight: true },
  bl: { bottom: 8, left: 8, borderBottom: true, borderLeft: true },
  br: { bottom: 8, right: 8, borderBottom: true, borderRight: true },
};

function CropMark({ position }: { position: CropPosition }) {
  const size = 14;
  const m = CROP_MAP[position];
  // Neutral bone marks — print-shop registration. Coloured accents stay
  // reserved for the section-level UI so plates don't compete with type.
  const mark = "1px solid rgba(229,224,213,0.55)";

  return (
    <span
      aria-hidden
      className="absolute pointer-events-none"
      style={{
        top: m.top,
        right: m.right,
        bottom: m.bottom,
        left: m.left,
        width: size,
        height: size,
        borderTop: m.borderTop ? mark : undefined,
        borderRight: m.borderRight ? mark : undefined,
        borderBottom: m.borderBottom ? mark : undefined,
        borderLeft: m.borderLeft ? mark : undefined,
      }}
    />
  );
}
