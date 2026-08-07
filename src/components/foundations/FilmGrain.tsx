"use client";

import styles from "./foundations.module.css";

type FilmGrainProps = {
  enabled: boolean;
};

export default function FilmGrain({ enabled }: FilmGrainProps) {
  return (
    <div
      aria-hidden
      className={`${styles.filmGrain} ${enabled ? styles.filmGrainVisible : ""}`}
    />
  );
}
