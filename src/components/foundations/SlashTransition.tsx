"use client";

import { motion, useReducedMotion } from "motion/react";
import styles from "./foundations.module.css";

type SlashTransitionProps = {
  active?: boolean;
  className?: string;
};

export default function SlashTransition({
  active = true,
  className = "",
}: SlashTransitionProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      aria-hidden
      className={`${styles.slashTransition} ${className}`}
      initial={
        reduceMotion
          ? false
          : { scaleY: 0.2, x: "-38vw", opacity: 0 }
      }
      animate={
        active
          ? {
              scaleY: 1,
              x: reduceMotion ? "0vw" : ["-38vw", "0vw", "38vw"],
              opacity: [0, 1, 1, 0],
            }
          : { scaleY: 0.2, x: "-38vw", opacity: 0 }
      }
      transition={
        reduceMotion
          ? { duration: 0.12 }
          : {
              duration: 1.6,
              delay: 0.7,
              times: [0, 0.16, 0.84, 1],
              ease: "easeInOut",
            }
      }
    />
  );
}
