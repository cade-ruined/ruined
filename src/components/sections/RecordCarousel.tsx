"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

export type RecordTone = "warm" | "shadow" | "atelier";

export type Project = {
  no: string;
  year: string;
  title: string;
  /** Short tagline shown on the sleeve + as the lead line in the detail. */
  brief: string;
  medium: string;
  tone: RecordTone;
  /** Longer description shown in the expanded detail view. */
  overview?: string;
  /** Salvaged / source materials, rendered as chips. */
  materials?: string[];
  /** e.g. "1 of 1", "Edition of 12". */
  edition?: string;
  /** e.g. "Archived", "In collection", "Available". */
  status?: string;
  /** Optional cover artwork (sleeve face) once provided. */
  image?: string;
  /** Gallery images shown in the detail carousel. */
  images?: string[];
};

// Album-cover backdrops — warm/shadow/atelier register, tuned richer so the
// covers read as art on the section. Exported so the hero "project hub"
// overlay can render matching record covers.
export const SLEEVE: Record<RecordTone, string> = {
  warm: "linear-gradient(150deg, #2c1a0d 0%, #4a2f17 42%, #1d1410 78%, #0a0707 100%)",
  shadow: "linear-gradient(160deg, #14110f 0%, #241d18 50%, #0b0908 100%)",
  atelier:
    "linear-gradient(135deg, #1a1611 0%, #34291b 40%, #1d1813 70%, #0a0807 100%)",
};

export const ACCENT: Record<RecordTone, string> = {
  warm: "var(--color-signal)",
  shadow: "var(--color-poster)",
  atelier: "var(--color-verdigris)",
};

const SPRING = { type: "spring", stiffness: 120, damping: 20 } as const;

const clampN = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

export default function RecordCarousel({ projects }: { projects: Project[] }) {
  const reduce = useReducedMotion();
  const last = projects.length - 1;
  const [active, setActive] = useState(() => Math.round(last / 2));
  const [playing, setPlaying] = useState(true);

  // Measure the stage so cover size, ring radius + label projection scale
  // with the viewport.
  const stageRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clampIdx = useCallback((n: number) => clampN(n, 0, last), [last]);
  const step = useCallback(
    (dir: number) => setActive((a) => clampIdx(a + dir)),
    [clampIdx]
  );

  // Pointer drag — sweep the ring; `moved` suppresses the release click.
  const drag = useRef({ down: false, startX: 0, moved: false });
  const SWIPE = 48;
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { down: true, startX: e.clientX, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.down) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > SWIPE) {
      step(dx < 0 ? 1 : -1);
      d.startX = e.clientX;
      d.moved = true;
    }
  };
  const onPointerUp = () => {
    drag.current.down = false;
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    }
  };

  // ─── Ring geometry ───────────────────────────────────────────────────
  const ready = dims.w > 0;
  const narrow = ready && dims.w < 640;
  const STEP = narrow ? 28 : 24; // deg between covers
  // TALL, NARROW portrait covers — the key to the stacked look. A turned
  // portrait panel reads as a thin vertical slat (folded-ribbon), whereas a
  // turned square just looks like a tilted square. Sized off the stage
  // height so the covers fill the vertical space like the reference.
  const panelH = ready
    ? clampN(
        Math.min(dims.h * 0.64, dims.w * (narrow ? 0.58 : 0.3)),
        170,
        narrow ? 340 : 320
      )
    : 240;
  const panelW = panelH * 0.5; // thin slats
  // Radius pulled in slightly under the edge-meeting value so neighbouring
  // covers butt together (tight seam, no cream showing through) — a packed
  // stack rather than a spaced-out fan.
  const radius = (panelW / (2 * Math.sin((STEP * Math.PI) / 360))) * 0.97;
  // Deep perspective so the front cover isn't blown up — covers stay close
  // in size, which reads as a denser stack rather than one hero + fall-off.
  const persp = narrow ? 1500 : 2100;

  // Perspective projection of a cover at angular distance `d` (steps) from
  // front — used to place the flat labels above each cover.
  const project = (d: number) => {
    const t = (d * STEP * Math.PI) / 180;
    const z = radius * Math.cos(t);
    const x = radius * Math.sin(t);
    const scale = persp / Math.max(persp - z, 1);
    return { x: x * scale, scale, front: Math.cos(t) > 0 };
  };
  const frontHalfH = (panelH * (persp / Math.max(persp - radius, 1))) / 2;
  const labelTop = dims.h / 2 - frontHalfH - 10;

  const current = projects[active];

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={stageRef}
        role="group"
        aria-roledescription="carousel"
        aria-label="Project records"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onKeyDown={onKeyDown}
        // Full-bleed on mobile so the fan bleeds off the real screen edges.
        className="relative flex-1 min-h-0 -mx-6 sm:mx-0 overflow-hidden cursor-grab active:cursor-grabbing select-none outline-none"
        style={{ perspective: persp }}
      >
        {ready && (
          <>
            {/* The cover ring */}
            <motion.div
              className="absolute left-1/2 top-1/2"
              style={{ transformStyle: "preserve-3d" }}
              initial={false}
              animate={{ rotateY: -active * STEP }}
              transition={reduce ? { duration: 0 } : SPRING}
            >
              {projects.map((p, i) => {
                const d = i - active;
                return (
                  <button
                    key={p.no}
                    type="button"
                    aria-label={`${p.title}, ${p.year}`}
                    aria-current={d === 0 ? "true" : undefined}
                    onClick={() => {
                      if (drag.current.moved) return;
                      if (d === 0) setPlaying((v) => !v);
                      else setActive(i);
                    }}
                    className="absolute appearance-none border-0 bg-transparent p-0 cursor-pointer"
                    style={{
                      width: panelW,
                      height: panelH,
                      marginLeft: -panelW / 2,
                      marginTop: -panelH / 2,
                      transform: `rotateY(${i * STEP}deg) translateZ(${radius}px)`,
                      transformStyle: "preserve-3d",
                      zIndex: 100 - Math.abs(d),
                    }}
                  >
                    <Cover project={p} front={d === 0} />
                  </button>
                );
              })}
            </motion.div>

            {/* Flat labels above each cover — title, medium, play caret. */}
            <div className="pointer-events-none absolute inset-0">
              {projects.map((p, i) => {
                const d = i - active;
                const { x, front } = project(d);
                const isActive = d === 0;
                return (
                  <motion.div
                    key={p.no}
                    className="absolute flex flex-col items-center text-center"
                    // Box is centred on the stage (left 50% − half width); the
                    // animated x slides it over the cover's projected centre.
                    style={{
                      top: labelTop,
                      left: "50%",
                      width: panelW,
                      marginLeft: -panelW / 2,
                    }}
                    initial={false}
                    animate={{
                      x,
                      // y:-100% anchors the label's bottom at `labelTop`, so it
                      // sits just above the front cover's top edge.
                      y: "-100%",
                      opacity: !front || Math.abs(d) > 3 ? 0 : isActive ? 1 : 0.55,
                    }}
                    transition={reduce ? { duration: 0 } : SPRING}
                  >
                    <span className="font-mono text-[0.62rem] sm:text-[0.68rem] tracking-[0.08em] text-[var(--color-faded)] leading-tight line-clamp-1 w-full">
                      {p.title}
                    </span>
                    <span className="mt-0.5 font-mono text-[0.5rem] sm:text-[0.54rem] tracking-[0.18em] uppercase text-[var(--muted-foreground)] leading-tight line-clamp-1 w-full">
                      {p.medium}
                    </span>
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 9 9"
                      className="mt-1.5"
                      style={{ color: isActive ? ACCENT[p.tone] : "var(--muted-foreground)" }}
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M1.5 0.8v7.4l6-3.7z" />
                    </svg>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}

        {/* ─── Bottom chrome ─────────────────────────────────────────── */}
        {/* current title — bottom-left, desktop */}
        <div className="pointer-events-none absolute bottom-3 left-1 hidden md:block">
          <div className="display text-2xl leading-none text-[var(--color-faded)]">
            {current.title}
          </div>
          <div className="mt-1 font-mono text-[0.6rem] tracking-[0.28em] uppercase text-[var(--muted-foreground)]">
            {current.medium}
            <span className="mx-2 text-[var(--border)]">·</span>
            {current.year}
          </div>
        </div>

        {/* transport — bottom-centre */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-4 sm:gap-5">
          <TransportButton
            label="Previous record"
            onClick={() => step(-1)}
            disabled={active === 0}
          >
            <SkipIcon dir="back" />
          </TransportButton>
          <TransportButton
            label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((v) => !v)}
            big
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </TransportButton>
          <TransportButton
            label="Next record"
            onClick={() => step(1)}
            disabled={active === last}
          >
            <SkipIcon dir="fwd" />
          </TransportButton>
        </div>

        {/* now playing — bottom-right, desktop */}
        <div className="pointer-events-none absolute bottom-3 right-1 hidden md:flex flex-col items-end text-right">
          <div className="flex items-center gap-1.5 font-mono text-[0.58rem] tracking-[0.3em] uppercase text-[var(--muted-foreground)]/70">
            {playing && (
              <motion.span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: ACCENT[current.tone] }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            Now playing
          </div>
          <div className="mt-0.5 font-mono text-[0.62rem] tracking-[0.28em] uppercase text-[var(--color-faded)]">
            Nº&nbsp;{current.no}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cover({ project, front }: { project: Project; front: boolean }) {
  const accent = ACCENT[project.tone];
  return (
    <div
      className="relative w-full h-full overflow-hidden transition-[box-shadow] duration-300"
      style={{
        background: SLEEVE[project.tone],
        boxShadow: front
          ? "inset 0 0 0 1px rgba(229,224,213,0.22), 0 30px 60px rgba(0,0,0,0.6)"
          : "inset 0 0 0 1px rgba(229,224,213,0.12), 0 16px 34px rgba(0,0,0,0.5)",
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(229,224,213,0.55) 0 1px, transparent 1px 60px)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(229,224,213,0.45) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
      {/* accent spine down the left edge */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accent, opacity: 0.85 }}
      />

      {/* top stamp */}
      <div className="absolute top-2.5 left-3 right-3 flex items-baseline justify-between font-mono text-[0.5rem] sm:text-[0.54rem] tracking-[0.28em] uppercase text-[var(--color-bone)]/65">
        <span>RUINED</span>
        <span className="tabular-nums">{project.year}</span>
      </div>

      {/* large index watermark — the cover reads as art */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="display text-[clamp(2.5rem,7vw,4.5rem)] leading-none text-[var(--color-bone)]/12">
          {project.no}
        </span>
      </div>

      {/* foot stamp */}
      <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between font-mono text-[0.5rem] sm:text-[0.54rem] tracking-[0.26em] uppercase">
        <span className="text-[var(--color-bone)]/45">Nº&nbsp;{project.no}</span>
        <span style={{ color: accent }}>·</span>
      </div>
    </div>
  );
}

function TransportButton({
  label,
  onClick,
  disabled,
  big,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  big?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.92 }}
      className={`flex items-center justify-center rounded-full border transition-colors duration-200 disabled:opacity-25 disabled:cursor-not-allowed ${
        big ? "w-12 h-12" : "w-9 h-9"
      }`}
      style={{
        borderColor: "var(--border)",
        background: big ? "var(--color-faded)" : "transparent",
      }}
    >
      <span style={{ color: big ? "var(--color-bone)" : "var(--color-faded)" }}>
        {children}
      </span>
    </motion.button>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <path d="M3 2.5v9l8-4.5z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <rect x="3" y="2.5" width="2.6" height="9" />
      <rect x="8.4" y="2.5" width="2.6" height="9" />
    </svg>
  );
}
function SkipIcon({ dir }: { dir: "back" | "fwd" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="currentColor"
      aria-hidden
      style={{ transform: dir === "back" ? "scaleX(-1)" : undefined }}
    >
      <path d="M2 3v8l5-4z" />
      <rect x="8" y="3" width="2" height="8" />
    </svg>
  );
}
