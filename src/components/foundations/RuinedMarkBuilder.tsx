"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import styles from "./artifact.module.css";

export type RuinedMarkProgress = 0 | 1 | 2 | 3 | 4;

export type RuinedMarkBuilderProps = {
  progress: RuinedMarkProgress;
  className?: string;
  label?: string;
};

const PIECES = [
  {
    d: "M9 10H43L38 36H13L9 10Z",
    hidden: { x: -12, y: -8, rotate: -5 },
  },
  {
    d: "M50 10H76L91 22L80 48L44 39L50 10Z",
    hidden: { x: 13, y: -7, rotate: 5 },
  },
  {
    d: "M13 42L39 47L34 90L8 82L13 42Z",
    hidden: { x: -11, y: 12, rotate: 4 },
  },
  {
    d: "M48 48L75 54L93 90H63L45 63L48 48Z",
    hidden: { x: 14, y: 11, rotate: -4 },
  },
] as const;

export default function RuinedMarkBuilder({
  progress,
  className = "",
  label = "Ruined mark",
}: RuinedMarkBuilderProps) {
  const reducedMotion = !!useReducedMotion();
  const titleId = useId();
  const visibleCount = Math.max(0, Math.min(4, progress));

  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-labelledby={titleId}
      className={`${styles.mark} ${className}`}
    >
      <title id={titleId}>{`${label}, ${visibleCount} of 4 pieces assembled`}</title>
      {PIECES.map((piece, index) => {
        const visible = index < visibleCount;
        return (
          <motion.path
            key={piece.d}
            d={piece.d}
            fill="currentColor"
            className={styles.markPiece}
            initial={false}
            animate={
              visible
                ? { opacity: 1, x: 0, y: 0, rotate: 0 }
                : { opacity: 0, ...piece.hidden }
            }
            transition={
              reducedMotion
                ? { duration: 0 }
                : {
                    duration: 0.58,
                    delay: visible ? index * 0.045 : 0,
                    ease: [0.22, 1, 0.36, 1],
                  }
            }
          />
        );
      })}
    </svg>
  );
}
