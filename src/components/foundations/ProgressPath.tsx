"use client";

import styles from "./foundations.module.css";

export type ProgressChapter = {
  number: string;
  title: string;
  momentIndex: number;
};

type ProgressPathProps = {
  chapters: ProgressChapter[];
  activeMoment: number;
  totalMoments: number;
  onSelect: (momentIndex: number) => void;
};

export default function ProgressPath({
  chapters,
  activeMoment,
  totalMoments,
  onSelect,
}: ProgressPathProps) {
  const progress =
    totalMoments > 1 ? Math.max(0, activeMoment / (totalMoments - 1)) : 0;

  return (
    <nav className={styles.progressPath} aria-label="Foundation chapters">
      <div className={styles.progressTrack} aria-hidden>
        <span
          className={styles.progressFill}
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
      <ol>
        {chapters.map((chapter, index) => {
          const active =
            activeMoment >= chapter.momentIndex &&
            (index === chapters.length - 1 ||
              activeMoment < chapters[index + 1].momentIndex);
          const completed =
            index < chapters.length - 1
              ? activeMoment >= chapters[index + 1].momentIndex
              : activeMoment > chapter.momentIndex;

          return (
            <li key={chapter.number}>
              <button
                type="button"
                onClick={() => onSelect(chapter.momentIndex)}
                aria-current={active ? "step" : undefined}
                className={`${styles.progressNode} ${
                  active ? styles.progressNodeActive : ""
                } ${completed ? styles.progressNodeComplete : ""}`}
                aria-label={`Go to ${chapter.title}`}
              >
                {chapter.number}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
