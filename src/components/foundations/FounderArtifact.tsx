"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FoundationFounder } from "@/data/foundations";
import styles from "./artifact.module.css";

export type FounderArtifactVariant = "tyler" | "mitch" | "cade" | "lib";

export type FounderArtifactProps = {
  founder: FoundationFounder;
  className?: string;
  dateStamp?: string;
  variant?: FounderArtifactVariant;
};

const DEFAULT_DATES: Record<FounderArtifactVariant, string> = {
  tyler: "08 · 17 · 19",
  mitch: "11 · 03 · 21",
  cade: "RU / MMXXVI",
  lib: "04 · 29 · 23",
};

function founderVariant(name: string): FounderArtifactVariant {
  const normalized = name.trim().toLowerCase();
  if (
    normalized === "tyler" ||
    normalized === "mitch" ||
    normalized === "cade" ||
    normalized === "lib"
  ) {
    return normalized;
  }
  return "tyler";
}

export default function FounderArtifact({
  founder,
  className = "",
  dateStamp,
  variant: requestedVariant,
}: FounderArtifactProps) {
  const variant = requestedVariant ?? founderVariant(founder.name);
  const reducedMotion = !!useReducedMotion();
  const descriptionId = useId();
  const [engaged, setEngaged] = useState(false);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, {
    stiffness: 150,
    damping: 25,
    mass: 0.35,
  });
  const springY = useSpring(pointerY, {
    stiffness: 150,
    damping: 25,
    mass: 0.35,
  });

  const rotateY = useTransform(springX, [-1, 1], [-2.1, 2.1]);
  const rotateX = useTransform(springY, [-1, 1], [1.7, -1.7]);
  const farX = useTransform(springX, [-1, 1], [-2, 2]);
  const farY = useTransform(springY, [-1, 1], [-1.5, 1.5]);
  const nearX = useTransform(springX, [-1, 1], [-7, 7]);
  const nearY = useTransform(springY, [-1, 1], [-5, 5]);

  const resetPointer = useCallback(() => {
    pointerX.set(0);
    pointerY.set(0);
  }, [pointerX, pointerY]);

  useEffect(() => {
    if (reducedMotion) resetPointer();
  }, [reducedMotion, resetPointer]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      reducedMotion ||
      event.pointerType !== "mouse" ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    pointerX.set(((event.clientX - bounds.left) / bounds.width - 0.5) * 2);
    pointerY.set(((event.clientY - bounds.top) / bounds.height - 0.5) * 2);
  };

  const details = founder.artifactElements
    .map((element) => element.label)
    .join(", ");

  return (
    <motion.button
      type="button"
      aria-label={`Inspect ${founder.artifactLabel}`}
      aria-describedby={descriptionId}
      aria-pressed={engaged}
      data-engaged={engaged ? "true" : undefined}
      className={`${styles.artifact} ${styles[variant]} ${className}`}
      style={{ rotateX, rotateY, transformPerspective: 1200 }}
      initial={false}
      animate={{
        scale: engaged && !reducedMotion ? 1.012 : 1,
      }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 240, damping: 28 }
      }
      onClick={() => setEngaged((current) => !current)}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      onBlur={resetPointer}
    >
      <span id={descriptionId} className="sr-only">
        {details}. Press to {engaged ? "settle" : "lift"} the artifact.
      </span>

      {/* Replace with real founder artifact photography. */}
      <span className={styles.artboard} aria-hidden="true">
        <motion.span
          className={styles.farLayer}
          style={{ x: farX, y: farY }}
        >
          <span className={styles.materialField} />
          <span className={styles.registration}>
            <span />
            <span />
            <span />
            <span />
          </span>
        </motion.span>

        <motion.span
          className={styles.objectLayer}
          style={{ x: nearX, y: nearY }}
        >
          <ArtifactObjects variant={variant} />
        </motion.span>

        <motion.span
          className={styles.noteLayer}
          style={{ x: nearX, y: nearY }}
        >
          <span className={styles.quoteCard}>
            <span className={styles.quote}>{founder.quote}</span>
            <span className={styles.noteIndex}>FIELD NOTE / 01</span>
          </span>
          <span className={styles.annotation} />
          <span className={styles.dateStamp}>
            {dateStamp ?? DEFAULT_DATES[variant]}
          </span>
        </motion.span>

        <span className={styles.founderLabel}>
          <span className={styles.founderName}>{founder.name}</span>
          <span>{founder.role}</span>
          <span>{founder.duration}</span>
        </span>

        <span className={styles.inspectHint}>
          <span>Artifact file</span>
          <span>{engaged ? "Set down" : "Inspect"} ↗</span>
        </span>
      </span>
    </motion.button>
  );
}

function ArtifactObjects({ variant }: { variant: FounderArtifactVariant }) {
  if (variant === "mitch") {
    return (
      <>
        <span className={styles.foldedLetter}>
          <span className={styles.foldLine} />
          <span className={styles.letterCopy}>WHAT IS MINE NOW?</span>
        </span>
        <span className={styles.map}>
          <span className={styles.mapRoute} />
          <span className={styles.mapPoint}>40.4 / 111.8</span>
        </span>
        <span className={styles.thread} />
      </>
    );
  }

  if (variant === "cade") {
    return (
      <>
        <span className={styles.sketchbook}>
          <span className={styles.sketchbookCode}>RU / FORM STUDY</span>
          <span className={styles.logoSketch}>
            <span />
            <span />
            <span />
            <span />
          </span>
        </span>
        <span className={styles.typeSpecimen}>
          <span>RUI</span>
          <span>NED</span>
          <span>FORM / FUNCTION</span>
        </span>
        <span className={styles.ruler} />
        <span className={styles.cutPaper}>MAKE IT VISIBLE</span>
      </>
    );
  }

  if (variant === "lib") {
    return (
      <>
        <span className={styles.tanMaterial} />
        <span className={styles.boundLetter}>
          <span className={styles.binding} />
          <span className={styles.letterCopy}>TO THE SELF I AM BECOMING</span>
        </span>
        <span className={styles.wornPhoto}>
          <span className={styles.photoImage} />
          <span className={styles.photoCode}>ARCHIVE / 04</span>
        </span>
        <span className={styles.flower}>
          <span className={styles.flowerStem} />
          <span className={styles.petalOne} />
          <span className={styles.petalTwo} />
          <span className={styles.petalThree} />
        </span>
        <span className={styles.metalToken}>04</span>
      </>
    );
  }

  return (
    <>
      <span className={styles.notebook}>
        <span className={styles.notebookSpine} />
        <span className={styles.notebookRule} />
        <span className={styles.notebookCode}>PAST / MOMENT / REFRAME</span>
      </span>
      <span className={styles.photograph}>
        <span className={styles.photoImage} />
        <span className={styles.photoCode}>UNTITLED / 01</span>
      </span>
      <span className={styles.tornPaper}>THE ENDING / EDITED</span>
    </>
  );
}
