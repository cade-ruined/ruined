"use client";

import { useEffect, useRef } from "react";
import type { FoundationChapter } from "@/data/foundations";
import styles from "./foundations.module.css";

type ChapterOverviewProps = {
  open: boolean;
  chapters: readonly FoundationChapter[];
  currentChapterId?: FoundationChapter["id"];
  onClose: () => void;
  onSelect: (chapterId: FoundationChapter["id"]) => void;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ChapterOverview({
  open,
  chapters,
  currentChapterId,
  onClose,
  onSelect,
}: ChapterOverviewProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.overviewBackdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.overviewDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="foundations-overview-title"
      >
        <div className={styles.overviewHeader}>
          <div>
            <p className={styles.eyebrow}>Chapter overview</p>
            <h2 id="foundations-overview-title">The shared path.</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close chapter overview"
          >
            <span aria-hidden>×</span>
          </button>
        </div>

        <ol className={styles.overviewChapters}>
          {chapters.map((chapter) => (
            <li key={chapter.id}>
              <button
                type="button"
                onClick={() => onSelect(chapter.id)}
                aria-current={
                  currentChapterId === chapter.id ? "location" : undefined
                }
              >
                <span>{chapter.number}</span>
                <strong>{chapter.title}</strong>
                <small>{chapter.coreQuestion}</small>
                <i aria-hidden>↗</i>
              </button>
            </li>
          ))}
        </ol>

        <p className={styles.overviewHint}>
          Select a chapter to move · Esc to close
        </p>
      </div>
    </div>
  );
}
