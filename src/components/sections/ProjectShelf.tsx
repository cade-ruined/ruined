"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PROJECTS, type Project } from "@/data/projects";
import { SLEEVE, ACCENT } from "./RecordCarousel";
import PlaceholderImage from "./PlaceholderImage";
import SiblingNav from "@/components/SiblingNav";

/**
 * /work — "The Ruined Projects" as a wall of record shelving.
 *
 * The shelving is drawn (a wooden unit divided into a responsive grid of
 * cubbies) so the shelf and the records are one layout system and always
 * align — 4×2 on desktop, 2×4 on mobile. The record-store photo stays
 * visible behind it as the room you're standing in.
 *
 * Each project is a real record: a vinyl disc seated in a face-out sleeve
 * with its own cover art. At rest every record sits flush in its cubby;
 * highlighting (hover/focus) or selecting (tap) one slides it up out of the
 * shelf — the vinyl rising clear of the sleeve — and lights the feature
 * panel. Move away and, unless a record is selected, the shelf settles back.
 *
 * On mount the whole unit swings in from the side — as if, coming from the
 * record-store scene in the home dive, the camera panned over to face it.
 */
export default function ProjectShelf() {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  // A record is "pulled" while highlighted, otherwise while selected.
  const pulled = hover ?? selected;
  const project = pulled != null ? PROJECTS[pulled] : null;

  return (
    <main className="relative min-h-[100svh] w-full bg-[#0b0908] text-[var(--color-bone)]">
      {/* ---- the record-store room (kept legible behind the shelf) ---- */}
      <div aria-hidden className="fixed inset-0 z-0">
        <picture className="block h-full w-full">
          <source srcSet="/ruined-work-shelf.avif" type="image/avif" />
          <source srcSet="/ruined-work-shelf.webp" type="image/webp" />
          <img
            src="/ruined-work-shelf.jpg"
            alt=""
            className="h-full w-full object-cover"
            style={{ filter: "blur(3px) brightness(0.62)" }}
          />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/20 to-black/80" />
      </div>

      <div
        className="relative z-10 mx-auto max-w-6xl px-6 sm:px-10 pt-8 sm:pt-12"
        style={{
          paddingBottom:
            "calc(var(--bottom-menu-h, 190px) + env(safe-area-inset-bottom, 0px) + 2rem)",
        }}
      >
        {/* ---- breadcrumb ---- */}
        <div className="flex items-baseline justify-between font-mono text-[0.62rem] sm:text-[0.7rem] tracking-[0.4em] uppercase text-[var(--color-bone)]/55">
          <Link
            href="/#work"
            className="hover:text-[var(--color-bone)] transition-colors duration-200"
          >
            ← Back
          </Link>
          <span>
            Work <span className="text-[var(--color-bone)]/30 mx-2">·</span> The
            Archive
          </span>
        </div>

        {/* ---- title + feature panel ---- */}
        <div className="mt-7 sm:mt-9 sm:flex sm:items-end sm:justify-between sm:gap-10">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            className="display text-[clamp(1.9rem,6vw,4.25rem)] leading-[0.95] text-[var(--color-bone)]"
            style={{ textShadow: "0 2px 24px rgba(0,0,0,0.6)" }}
          >
            THE{" "}
            <span className="italic text-[var(--color-verdigris)]">RUINED</span>{" "}
            PROJECTS
          </motion.h1>

          <motion.div
            key={project ? project.no : "none"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="mt-5 sm:mt-0 max-w-sm shrink-0 sm:text-right"
          >
            {project ? (
              <>
                <div className="flex items-center gap-3 font-mono text-[0.6rem] tracking-[0.36em] uppercase text-[var(--color-bone)]/55 sm:justify-end">
                  <span>Nº {project.no}</span>
                  <span className="text-[var(--color-bone)]/25">·</span>
                  <span>{project.year}</span>
                  <span className="text-[var(--color-bone)]/25">·</span>
                  <span style={{ color: ACCENT[project.tone] }}>
                    {project.medium}
                  </span>
                </div>
                <p className="mt-2 text-[0.95rem] sm:text-base leading-relaxed text-[var(--color-bone)]/85">
                  {project.brief}
                </p>
              </>
            ) : (
              <p className="font-mono text-[0.62rem] tracking-[0.32em] uppercase text-[var(--color-bone)]/45">
                {String(PROJECTS.length).padStart(2, "0")} projects, filed —
                hover or tap a record to inspect.
              </p>
            )}
          </motion.div>
        </div>

        {/* ---- the shelving unit (swings in from the side) ---- */}
        <div style={{ perspective: "1600px" }} className="mt-8 sm:mt-10">
          <motion.div
            className="relative rounded-[5px]"
            initial={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, rotateY: 22, x: "9%", scale: 1.06 }
            }
            animate={
              reduce
                ? { opacity: 1 }
                : { opacity: 1, rotateY: 0, x: "0%", scale: 1 }
            }
            transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            style={{
              transformOrigin: "100% 50%",
              background:
                "linear-gradient(180deg, #3a2917 0%, #2a1d10 50%, #1d130b 100%)",
              padding: "clamp(12px, 2.2vw, 22px)",
              boxShadow:
                "0 40px 90px rgba(0,0,0,0.7), 0 2px 0 rgba(255,255,255,0.05) inset, 0 -3px 10px rgba(0,0,0,0.6) inset",
            }}
          >
            {/* faint wood grain */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[5px] opacity-[0.06]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, rgba(0,0,0,0.8) 0 1px, transparent 1px 6px)",
              }}
            />

            <div
              className="relative grid grid-cols-2 md:grid-cols-4"
              style={{ gap: "clamp(12px, 2.2vw, 22px)" }}
            >
              {PROJECTS.map((p, i) => (
                <RecordSlot
                  key={p.no}
                  project={p}
                  index={i}
                  active={i === pulled}
                  reduce={!!reduce}
                  onEnter={() => setHover(i)}
                  onLeave={() =>
                    setHover((h) => (h === i ? null : h))
                  }
                  onSelect={() =>
                    setSelected((s) => (s === i ? null : i))
                  }
                />
              ))}
            </div>
          </motion.div>
        </div>

        <p className="mt-5 text-center font-mono text-[0.58rem] tracking-[0.4em] uppercase text-[var(--color-bone)]/45">
          —— tap a record to pull it and read the file ——
        </p>

        <footer className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-bone)]/12 pt-6 font-mono text-[0.65rem] tracking-[0.4em] uppercase text-[var(--color-bone)]/55">
          <Link
            href="/"
            className="inline-flex items-center gap-2 transition-colors duration-200 hover:text-[var(--color-bone)]"
          >
            <span aria-hidden>←</span>
            <span>Return home</span>
          </Link>
          <SiblingNav />
        </footer>
      </div>

      {/* ---- selected-record detail ---- */}
      <AnimatePresence>
        {selected != null && (
          <RecordDetail
            key="detail"
            project={PROJECTS[selected]}
            index={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function RecordSlot({
  project: p,
  index,
  active,
  reduce,
  onEnter,
  onLeave,
  onSelect,
}: {
  project: Project;
  index: number;
  active: boolean;
  reduce: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onSelect: () => void;
}) {
  // Hover/leave only for fine pointers; touch drives selection via click so a
  // record never gets stuck "highlighted" after a tap.
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") onEnter();
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") onLeave();
  };

  // Once a real cover loads, step the drawn motif + caption back so the
  // artwork reads on its own. Until then (or if it fails), show the motif.
  const [coverOk, setCoverOk] = useState(false);
  const showArt = !coverOk;

  return (
    <div className="flex flex-col">
      {/* the cubby — a recessed slot in the shelf */}
      <div
        className="relative aspect-square rounded-[3px]"
        style={{
          background: "linear-gradient(180deg, #0c0805 0%, #19110b 100%)",
          boxShadow:
            "inset 0 12px 22px rgba(0,0,0,0.8), inset 0 -4px 8px rgba(0,0,0,0.5)",
        }}
      >
      <motion.button
        type="button"
        aria-label={`Project ${p.no} — ${p.title}`}
        aria-pressed={active}
        onClick={onSelect}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={onEnter}
        onBlur={onLeave}
        className="absolute inset-[4%] origin-bottom cursor-pointer focus:outline-none"
        initial={false}
        animate={
          reduce
            ? { y: 0, scale: 1 }
            : { y: active ? "-13%" : 0, scale: active ? 1.04 : 1 }
        }
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        style={{ zIndex: active ? 30 : 10 }}
      >
        {/* the vinyl — seated behind the sleeve, peeking from the mouth at
            rest, sliding clear when the record is pulled */}
        <motion.div
          aria-hidden
          className="absolute left-[10%] top-0 aspect-square w-[80%] overflow-hidden rounded-full"
          style={{
            background: "#0a0807",
            boxShadow:
              "0 8px 18px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(255,255,255,0.06)",
          }}
          initial={false}
          animate={{ y: active && !reduce ? "-40%" : "-8%" }}
          transition={{ type: "spring", stiffness: 240, damping: 26 }}
        >
          {/* pressed grooves */}
          <span
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "repeating-radial-gradient(circle at 50% 50%, #050403 0px, #050403 1px, #18130f 1px, #18130f 2.5px)",
            }}
          />
          {/* a darker run-out ring just outside the label */}
          <span
            className="absolute inset-[30%] rounded-full"
            style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.6)" }}
          />
          {/* glossy reflection — two soft light arcs sweeping the disc */}
          <span
            className="absolute inset-0 rounded-full mix-blend-screen"
            style={{
              background:
                "conic-gradient(from 35deg at 50% 50%, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.22) 24deg, rgba(255,255,255,0) 62deg, rgba(255,255,255,0) 180deg, rgba(255,255,255,0.14) 214deg, rgba(255,255,255,0) 252deg)",
            }}
          />

          {/* center label */}
          <span
            className="absolute left-1/2 top-1/2 grid aspect-square w-[38%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
            style={{
              background: ACCENT[p.tone],
              boxShadow:
                "inset 0 0 0 1px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.4)",
            }}
          >
            <span className="absolute inset-[16%] rounded-full border border-black/20" />
            <span
              className="font-mono font-semibold leading-none"
              style={{ color: "#120d08", fontSize: "0.62rem" }}
            >
              {p.no}
            </span>
          </span>

          {/* spindle hole */}
          <span
            className="absolute left-1/2 top-1/2 aspect-square w-[4.5%] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background: "#0b0908",
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)",
            }}
          />
        </motion.div>

        {/* the sleeve */}
        <div
          className="absolute inset-0 overflow-hidden rounded-[2px]"
          style={{
            backgroundImage: SLEEVE[p.tone],
            boxShadow: active
              ? "0 24px 46px rgba(0,0,0,0.72)"
              : "0 8px 18px rgba(0,0,0,0.55)",
            filter: active ? "none" : "brightness(0.82)",
            transition: "filter 0.3s ease, box-shadow 0.3s ease",
          }}
        >
          {/* drawn motif — recognizability fallback before real art loads */}
          {showArt && <CoverArt index={index} accent={ACCENT[p.tone]} />}

          {/* real cover artwork, when provided */}
          {p.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.image}
              alt={p.title}
              onLoad={() => setCoverOk(true)}
              onError={() => setCoverOk(false)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}

          {/* sleeve mouth — the vinyl emerges from here (physical, always on) */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-3"
            style={{
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)",
            }}
          />
          {/* glossy sleeve sheen */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(115deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 42%)",
            }}
          />

          {/* label tooltip — top-right, revealed when the record is pulled */}
          <motion.div
            className="pointer-events-none absolute right-2 top-2 flex max-w-[90%] items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 backdrop-blur-sm"
            initial={false}
            animate={{
              opacity: active ? 1 : 0,
              y: active ? 0 : -4,
            }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: ACCENT[p.tone] }}
            />
            <span className="truncate font-mono text-[0.5rem] tracking-[0.22em] uppercase text-[var(--color-bone)]">
              {p.title}
            </span>
          </motion.div>
        </div>
      </motion.button>
      </div>

      {/* engraved nameplate on the cabinet wood */}
      <div className="px-1 pt-2 text-center">
        <span
          className="block truncate font-mono text-[0.5rem] tracking-[0.24em] uppercase text-[var(--color-bone)]/85 sm:text-[0.55rem]"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
        >
          {p.no} · {p.title}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The detail view for a selected record. On mobile it rises as a bottom sheet
 * (clear of the couch); on desktop it's a centered card. The record's cover
 * sits alongside the full project file, so a tap reads as opening the record.
 */
function RecordDetail({
  project: p,
  index,
  onClose,
}: {
  project: Project;
  index: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape + lock background scroll while open.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button")?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center sm:p-6"
      style={{
        paddingBottom:
          "calc(var(--bottom-menu-h, 190px) + env(safe-area-inset-bottom, 0px) + 1rem)",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close project detail"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      {/* card */}
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Project ${p.no} — ${p.title}`}
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--color-bone)]/12"
        style={{
          background: "linear-gradient(180deg, #14100c 0%, #0b0807 100%)",
          boxShadow: "0 40px 90px rgba(0,0,0,0.7)",
          maxHeight:
            "calc(100svh - var(--bottom-menu-h, 190px) - env(safe-area-inset-bottom, 0px) - 4rem)",
        }}
        initial={{ y: 36, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 28, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
      >
        {/* accent top rule */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 z-10 h-[3px]"
          style={{ background: ACCENT[p.tone] }}
        />

        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-[var(--color-bone)]/70 transition-colors hover:bg-white/10 hover:text-[var(--color-bone)]"
        >
          <span className="text-lg leading-none">×</span>
        </button>

        <div className="no-scrollbar overflow-y-auto">
        <div className="flex gap-5 p-5 sm:gap-6 sm:p-7">
          {/* the cover */}
          <div
            className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-[3px] sm:w-32"
            style={{
              backgroundImage: SLEEVE[p.tone],
              boxShadow: "0 10px 24px rgba(0,0,0,0.6)",
            }}
          >
            <CoverArt index={index} accent={ACCENT[p.tone]} />
            <CoverImage src={p.image} alt={p.title} />
          </div>

          {/* heading */}
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[0.6rem] tracking-[0.34em] uppercase text-[var(--color-bone)]/55">
              Nº {p.no} <span className="text-[var(--color-bone)]/25">·</span>{" "}
              {p.year}
            </div>
            <h2 className="display mt-2 text-[clamp(1.5rem,7vw,2.25rem)] leading-[0.98] text-[var(--color-bone)]">
              {p.title}
            </h2>
            <div
              className="mt-3 inline-block rounded-full border px-3 py-1 font-mono text-[0.55rem] tracking-[0.28em] uppercase"
              style={{
                color: ACCENT[p.tone],
                borderColor: "color-mix(in srgb, var(--color-bone) 18%, transparent)",
              }}
            >
              {p.medium}
            </div>
          </div>
        </div>

        {/* file body */}
        <div className="px-5 pb-6 sm:px-7 sm:pb-7">
          {/* lead tagline */}
          <p
            className="text-[0.78rem] font-medium italic tracking-wide"
            style={{ color: ACCENT[p.tone] }}
          >
            {p.brief}
          </p>

          {p.overview && (
            <p className="mt-3 text-[0.98rem] leading-relaxed text-[var(--color-bone)]/85 sm:text-base">
              {p.overview}
            </p>
          )}

          {p.images && p.images.length > 0 && (
            <div className="mt-5">
              <DetailCarousel
                images={p.images}
                accent={ACCENT[p.tone]}
                title={p.title}
              />
            </div>
          )}

          <div className="mt-5 flex items-center justify-between font-mono text-[0.58rem] tracking-[0.32em] uppercase text-[var(--color-bone)]/45">
            <span>—— Ruined archive ——</span>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--color-bone)]/70 transition-colors hover:text-[var(--color-bone)]"
            >
              File back ↩
            </button>
          </div>
        </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Swipeable image carousel for the detail view. Uses native horizontal
 * scroll-snap (so touch swipe just works) with overlaid arrows + dots.
 */
function DetailCarousel({
  images,
  accent,
  title,
}: {
  images: string[];
  accent: string;
  title: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const n = images.length;

  const go = (next: number) => {
    const t = trackRef.current;
    if (!t) return;
    const clamped = Math.max(0, Math.min(n - 1, next));
    t.scrollTo({ left: clamped * t.clientWidth, behavior: "smooth" });
  };

  const onScroll = () => {
    const t = trackRef.current;
    if (!t) return;
    setIdx(Math.round(t.scrollLeft / t.clientWidth));
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-[var(--color-bone)]/10 bg-black">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
      >
        {images.map((src, i) => (
          <CarouselSlide key={i} src={src} title={title} index={i} />
        ))}
      </div>

      {/* counter */}
      <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-2 py-0.5 font-mono text-[0.55rem] tracking-[0.15em] text-[var(--color-bone)]/85">
        {idx + 1} / {n}
      </div>

      {n > 1 && (
        <>
          <CarouselArrow
            dir="prev"
            disabled={idx === 0}
            onClick={() => go(idx - 1)}
          />
          <CarouselArrow
            dir="next"
            disabled={idx === n - 1}
            onClick={() => go(idx + 1)}
          />

          {/* dots */}
          <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to image ${i + 1}`}
                onClick={() => go(i)}
                className="h-1.5 rounded-full transition-all duration-200"
                style={{
                  width: i === idx ? 16 : 6,
                  background:
                    i === idx ? accent : "rgba(229,224,213,0.45)",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One carousel slide. Renders the real photo when it loads; if the file is
 * missing/broken it swaps in the local editorial PlaceholderImage (no external
 * dependency — the old picsum.photos fallback could be slow or unavailable).
 */
function CarouselSlide({
  src,
  title,
  index,
}: {
  src: string;
  title: string;
  index: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-[4/3] w-full shrink-0 snap-center">
      {failed ? (
        <PlaceholderImage
          ratio="4/3"
          tone="shadow"
          label={`${title} · ${String(index + 1).padStart(2, "0")}`}
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${title} — image ${index + 1}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}

function CarouselArrow({
  dir,
  disabled,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={dir === "prev" ? "Previous image" : "Next image"}
      onClick={onClick}
      disabled={disabled}
      className={`absolute top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-[var(--color-bone)] backdrop-blur-sm transition-opacity duration-200 hover:bg-black/70 ${
        dir === "prev" ? "left-2" : "right-2"
      } ${disabled ? "pointer-events-none opacity-0" : "opacity-90"}`}
    >
      <span className="text-base leading-none">
        {dir === "prev" ? "‹" : "›"}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Real cover artwork overlay. Renders on top of the drawn motif when an image
 * is provided; if the file is missing/broken it removes itself, revealing the
 * motif underneath — so a project can be wired before its photo exists.
 */
function CoverImage({ src, alt }: { src?: string; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setOk(false)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/**
 * A distinct abstract motif per record (cycled by index) plus a large ghosted
 * catalog numeral — gives each sleeve its own identity so they're tellable
 * apart at a glance, without needing real album photography.
 */
function CoverArt({ index, accent }: { index: number; accent: string }) {
  const motif = index % 4;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        style={{ opacity: 0.5 }}
        fill="none"
        stroke={accent}
        strokeWidth={2}
      >
        {motif === 0 && (
          // grooves
          <>
            <circle cx="50" cy="40" r="9" />
            <circle cx="50" cy="40" r="18" />
            <circle cx="50" cy="40" r="27" />
            <circle cx="50" cy="40" r="36" />
          </>
        )}
        {motif === 1 && (
          // signal bars
          <g strokeWidth={4}>
            <line x1="24" y1="60" x2="24" y2="30" />
            <line x1="38" y1="60" x2="38" y2="16" />
            <line x1="52" y1="60" x2="52" y2="38" />
            <line x1="66" y1="60" x2="66" y2="22" />
            <line x1="80" y1="60" x2="80" y2="44" />
          </g>
        )}
        {motif === 2 && (
          // orbit
          <>
            <circle cx="64" cy="32" r="30" />
            <circle cx="34" cy="48" r="3.5" fill={accent} stroke="none" />
            <line x1="20" y1="62" x2="78" y2="14" />
          </>
        )}
        {motif === 3 && (
          // crosshair + diamond
          <>
            <line x1="50" y1="10" x2="50" y2="66" />
            <line x1="18" y1="38" x2="82" y2="38" />
            <rect
              x="34"
              y="22"
              width="32"
              height="32"
              transform="rotate(45 50 38)"
            />
          </>
        )}
      </svg>
    </span>
  );
}
