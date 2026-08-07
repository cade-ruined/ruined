"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type {
  FoundationMotionTreatment,
  FoundationWord,
} from "@/data/foundations";
import styles from "./foundations.module.css";

type WordSequenceProps = {
  words: readonly FoundationWord[];
  active?: boolean;
};

function initialFor(treatment: FoundationMotionTreatment) {
  switch (treatment) {
    case "blur-to-focus":
      return { opacity: 0, filter: "blur(14px)", scale: 1.08, x: 0, y: 0 };
    case "contract":
      return { opacity: 0, filter: "blur(0px)", scale: 1.7, x: 0, y: 0 };
    case "open":
      return { opacity: 0, filter: "blur(0px)", scale: 0.78, x: 0, y: 0 };
    case "duplicate-resolve":
      return { opacity: 0, filter: "blur(1px)", scale: 1, x: -42, y: 0 };
    case "fragment-align":
      return { opacity: 0, filter: "blur(2px)", scale: 1, x: 52, y: -12 };
    case "assemble":
      return { opacity: 0, filter: "blur(0px)", scale: 0.68, x: 0, y: 24 };
    default:
      return { opacity: 0, filter: "blur(0px)", scale: 1, x: 32, y: 0 };
  }
}

export default function WordSequence({
  words,
  active = true,
}: WordSequenceProps) {
  const reduceMotion = useReducedMotion();
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setWordIndex(0);
      return;
    }
    if (reduceMotion) {
      setWordIndex(words.length - 1);
      return;
    }
    setWordIndex(0);
    const timer = window.setInterval(() => {
      setWordIndex((current) => {
        if (current >= words.length - 1) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 640);
    return () => window.clearInterval(timer);
  }, [active, reduceMotion, words.length]);

  const current = words[wordIndex];

  return (
    <div
      className={styles.wordSequence}
      aria-label={words.map(({ word }) => word).join(", ")}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={current.word}
          aria-hidden
          data-treatment={current.treatment}
          className={styles.wordSequenceWord}
          initial={initialFor(current.treatment)}
          animate={{
            opacity: 1,
            filter: "blur(0px)",
            scale: 1,
            x: 0,
            y: 0,
          }}
          exit={{
            opacity: 0,
            filter: current.treatment === "blur-to-focus" ? "blur(9px)" : "blur(0px)",
            scale: current.treatment === "contract" ? 0.55 : 1,
            x: current.treatment === "open" ? 48 : -28,
            y: 0,
          }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.42, ease: [0.22, 1, 0.36, 1] }
          }
        >
          {current.word}
        </motion.span>
      </AnimatePresence>
      <div className={styles.wordSequenceMeta} aria-hidden>
        <span>{String(wordIndex + 1).padStart(2, "0")}</span>
        <i>
          <b style={{ transform: `scaleX(${(wordIndex + 1) / words.length})` }} />
        </i>
        <span>{String(words.length).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
