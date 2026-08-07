"use client";

import { useRef, useState } from "react";
import styles from "./foundations.module.css";

type PresenterControlsProps = {
  canGoPrevious: boolean;
  canGoNext: boolean;
  grainEnabled: boolean;
  soundEnabled: boolean;
  overviewOpen: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onOverview: () => void;
  onToggleGrain: () => void;
  onToggleSound: () => void;
  onRestart: () => void;
  onFullscreen: () => void;
};

export default function PresenterControls({
  canGoPrevious,
  canGoNext,
  grainEnabled,
  soundEnabled,
  overviewOpen,
  onPrevious,
  onNext,
  onOverview,
  onToggleGrain,
  onToggleSound,
  onRestart,
  onFullscreen,
}: PresenterControlsProps) {
  const [open, setOpen] = useState(false);
  const handleRef = useRef<HTMLButtonElement>(null);
  const suppressFocusOpen = useRef(false);

  const closeControls = () => {
    suppressFocusOpen.current = true;
    handleRef.current?.focus();
    setOpen(false);
    requestAnimationFrame(() => {
      suppressFocusOpen.current = false;
    });
  };

  return (
    <aside
      className={styles.presenterZone}
      aria-label="Presenter controls"
      data-open={open ? "true" : "false"}
    >
      <button
        ref={handleRef}
        type="button"
        className={styles.presenterHandle}
        aria-label="Show presenter controls"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onFocus={() => {
          if (!suppressFocusOpen.current) setOpen(true);
        }}
      >
        <span aria-hidden>••</span>
      </button>
      <div className={styles.presenterDock}>
        <button
          type="button"
          onClick={onPrevious}
          disabled={!canGoPrevious}
          aria-label="Previous moment"
          tabIndex={open ? 0 : -1}
        >
          <span aria-hidden>←</span>
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canGoNext}
          aria-label="Next moment"
          tabIndex={open ? 0 : -1}
        >
          <span aria-hidden>→</span>
        </button>
        <span className={styles.presenterDivider} aria-hidden />
        <button
          type="button"
          onClick={onOverview}
          aria-label="Chapter overview"
          aria-expanded={overviewOpen}
          tabIndex={open ? 0 : -1}
        >
          <span aria-hidden>⌘</span>
        </button>
        <button
          type="button"
          onClick={onToggleGrain}
          aria-label="Toggle film grain"
          aria-pressed={grainEnabled}
          tabIndex={open ? 0 : -1}
        >
          <span aria-hidden>{grainEnabled ? "G" : "G̸"}</span>
        </button>
        <button
          type="button"
          onClick={onToggleSound}
          aria-label="Toggle ambient sound label"
          aria-pressed={soundEnabled}
          tabIndex={open ? 0 : -1}
        >
          <span aria-hidden>{soundEnabled ? "S+" : "S−"}</span>
        </button>
        <button
          type="button"
          onClick={onRestart}
          aria-label="Restart experience"
          tabIndex={open ? 0 : -1}
        >
          <span aria-hidden>↺</span>
        </button>
        <button
          type="button"
          onClick={onFullscreen}
          aria-label="Enter fullscreen"
          tabIndex={open ? 0 : -1}
        >
          <span aria-hidden>⛶</span>
        </button>
        <button
          type="button"
          onClick={closeControls}
          aria-label="Hide presenter controls"
          tabIndex={open ? 0 : -1}
        >
          <span aria-hidden>×</span>
        </button>
      </div>
    </aside>
  );
}
