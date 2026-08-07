"use client";

import {
  useRef,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useReducedMotion } from "motion/react";
import styles from "./foundations.module.css";

type CursorParallaxProps = {
  children: ReactNode;
  className?: string;
  strength?: number;
};

type ParallaxStyle = CSSProperties & {
  "--parallax-x": string;
  "--parallax-y": string;
};

export default function CursorParallax({
  children,
  className = "",
  strength = 10,
}: CursorParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || event.pointerType === "touch" || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * strength;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * strength;
    ref.current.style.setProperty("--parallax-x", `${x}px`);
    ref.current.style.setProperty("--parallax-y", `${y}px`);
  };

  const reset = () => {
    ref.current?.style.setProperty("--parallax-x", "0px");
    ref.current?.style.setProperty("--parallax-y", "0px");
  };

  return (
    <div
      ref={ref}
      className={`${styles.cursorParallax} ${className}`}
      style={
        {
          "--parallax-x": "0px",
          "--parallax-y": "0px",
        } as ParallaxStyle
      }
      onPointerMove={move}
      onPointerLeave={reset}
    >
      {children}
    </div>
  );
}
