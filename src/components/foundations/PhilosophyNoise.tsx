"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import styles from "./foundations.module.css";

type PhilosophyNoiseProps = {
  fragments: readonly string[];
  result: string;
  active: boolean;
};

type FragmentStyle = React.CSSProperties & {
  "--noise-x": string;
  "--noise-y": string;
  "--noise-r": string;
  "--noise-delay": string;
};

const WORD_FIELD_HOLD_MS = 3200;

export default function PhilosophyNoise({
  fragments,
  result,
  active,
}: PhilosophyNoiseProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const fieldIsVisible = useInView(fieldRef, { amount: 0.7 });
  const reduceMotion = useReducedMotion();
  const [resolved, setResolved] = useState(false);
  const particles = useMemo(
    () =>
      Array.from({ length: 120 }, (_, index) => {
        const x = (index * 47 + (index % 7) * 19) % 100;
        const y = (index * 73 + (index % 11) * 7) % 100;
        const rotation = ((index * 29) % 52) - 26;
        return {
          id: index,
          word: fragments[index % fragments.length],
          style: {
            "--noise-x": `${x}%`,
            "--noise-y": `${y}%`,
            "--noise-r": `${rotation}deg`,
            "--noise-delay": `${(index % 17) * 18}ms`,
          } as FragmentStyle,
        };
      }),
    [fragments]
  );

  useEffect(() => {
    if (!active || !fieldIsVisible) {
      setResolved(false);
      return;
    }

    if (reduceMotion) {
      setResolved(true);
      return;
    }

    setResolved(false);
    const timer = window.setTimeout(
      () => setResolved(true),
      WORD_FIELD_HOLD_MS
    );
    return () => window.clearTimeout(timer);
  }, [active, fieldIsVisible, reduceMotion]);

  return (
    <div
      ref={fieldRef}
      className={`${styles.noiseField} ${
        resolved ? styles.noiseFieldResolved : ""
      } ${reduceMotion ? styles.noiseFieldReduced : ""}`}
      aria-label={`${result}. Noise resolves into choice.`}
    >
      <div className={styles.noiseFragments} aria-hidden>
        {particles.map((particle) => (
          <span key={particle.id} style={particle.style}>
            {particle.word}
          </span>
        ))}
      </div>
      <span className={styles.noiseSlash} aria-hidden />
      <span className={styles.noiseResult}>{result}</span>
      <p className={styles.noiseCaption}>
        What remains after everything unnecessary is removed.
      </p>
    </div>
  );
}
