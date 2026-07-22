"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import type { Product } from "@/data/products";
import { PROJECTS, projectSlug, type Project } from "@/data/projects";
import { EVENTS, type StudioEvent } from "@/data/events";
import RoomSequenceCanvas from "@/components/sequence/RoomSequenceCanvas";
import { SEQUENCE_ROOMS, type SequenceManifest } from "@/data/sequences";
import { scrollState } from "@/utils/scrollState";

// ─── The journey ────────────────────────────────────────────────────────
// One continuous walk. The homepage is a scroll-scrubbed frame sequence: each
// room ships a pre-rendered dolly move (public/sequences/<room>/), and scrolling
// simply advances the concatenated frames on a canvas — no crossfades, no CSS
// portal masks. The transitions between rooms are already baked into the frames
// (each room's dolly ends facing the next). The editorial UI (room shelves,
// wordmark, "After The Fear") floats on top, keyed to where each room sits in
// the timeline.

// Scroll-linked spring — smooths discrete wheel/trackpad ticks into fluid
// motion. Tuned near critical damping (ratio ≈ 1) so it responds immediately
// without the laggy "wind-up then catch-up" of over-damped values, and without
// any overshoot/bounce.
const SCROLL_SPRING = {
  stiffness: 150,
  damping: 16,
  mass: 0.4,
  restDelta: 0.0002,
} as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// The room walk, Fireside arrival, and closing title each get their own phase.
// This guarantees Lounge reaches its final frame before the video appears, and
// gives the loop time to establish before "After The Fear" begins.
const SEQUENCE_END = 0.78;
const FEAR_START = 0.88;
const FIRESIDE_SRC = "/sequences/fireside/Fire and Stream Looping 4K.mp4";
const ROOM_HOLD = 0.055;

// A room's slice of the whole-journey timeline (0..1), derived from its frame
// count, plus where its overlay should peak.
type Band = {
  start: number;
  playEnd: number;
  end: number;
  mid: number;
  count: number;
  frameStart: number;
  frameEnd: number;
};

// Events begin with the first moving fire frame and remain available through
// the fireside beat, then clear before the closing title arrives.
const FIRESIDE_EVENT_BAND: Band = {
  start: SEQUENCE_END - 0.025,
  playEnd: SEQUENCE_END,
  end: FEAR_START - 0.03,
  mid: (SEQUENCE_END + FEAR_START - 0.03) / 2,
  count: 1,
  frameStart: 1,
  frameEnd: 1,
};

function buildSequenceBands(manifest: SequenceManifest): Record<string, Band> {
  const map: Record<string, Band> = {};
  const activeRooms = manifest.rooms.filter((room) => room.count > 0);
  const totalHoldSpan = activeRooms.reduce(
    (total, room) => total + (room.id === "lounge" ? 0 : ROOM_HOLD),
    0
  );
  const playableSpan = Math.max(0, SEQUENCE_END - totalHoldSpan);
  const frameDenominator = Math.max(1, manifest.total - 1);
  let timelineCursor = 0;
  let frameCursor = 0;

  for (const room of manifest.rooms) {
    if (!room.count) {
      map[room.id] = {
        start: timelineCursor,
        playEnd: timelineCursor,
        end: timelineCursor,
        mid: timelineCursor,
        count: 0,
        frameStart: frameCursor / frameDenominator,
        frameEnd: frameCursor / frameDenominator,
      };
      continue;
    }

    const start = timelineCursor;
    const playDuration = playableSpan * (room.count / manifest.total);
    const playEnd = start + playDuration;
    // Lounge already resolves into the Fireside composition. Holding its final
    // still creates a visible hitch before the matching loop begins, so it hands
    // off immediately while the other room arrivals retain their pause.
    const holdDuration = room.id === "lounge" ? 0 : ROOM_HOLD;
    const end = playEnd + holdDuration;
    const frameStart = frameCursor / frameDenominator;
    const frameEnd = (frameCursor + room.count - 1) / frameDenominator;
    map[room.id] = {
      start,
      playEnd,
      end,
      mid: (start + playEnd) / 2,
      count: room.count,
      frameStart,
      frameEnd,
    };
    timelineCursor = end;
    frameCursor += room.count;
  }

  return map;
}

function sequenceFrameProgress(value: number, manifest: SequenceManifest, bands: Record<string, Band>) {
  for (const room of manifest.rooms) {
    const band = bands[room.id];
    if (!band || !band.count) continue;
    if (value <= band.playEnd) {
      const local = clamp01((value - band.start) / Math.max(0.0001, band.playEnd - band.start));
      return band.frameStart + (band.frameEnd - band.frameStart) * local;
    }
    if (value <= band.end) return band.frameEnd;
  }
  return 1;
}

function HardButton({
  href,
  label,
  variant,
  rotation,
  onClick,
}: {
  href: string;
  label: string;
  variant: "filled" | "outline";
  rotation: number;
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const isFilled = variant === "filled";

  return (
    <motion.a
      href={href}
      onClick={onClick}
      initial={false}
      whileHover={{ x: -2, y: -2, rotate: 0 }}
      whileTap={{ x: 3, y: 3, rotate: 0 }}
      transition={{ type: "spring", stiffness: 360, damping: 22 }}
      className="relative flex items-center justify-between gap-2 px-4 py-3 font-mono text-[0.55rem] tracking-[0.18em] uppercase no-underline select-none whitespace-nowrap"
      style={{
        rotate: rotation,
        background: isFilled ? "var(--color-poster)" : "var(--color-bone)",
        color: isFilled ? "var(--color-bone)" : "var(--color-faded)",
        border: "1.5px solid var(--color-faded)",
        boxShadow: "5px 5px 0 0 var(--color-faded)",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage:
            "radial-gradient(rgba(20,15,12,0.7) 0.6px, transparent 0.6px)",
          backgroundSize: "2.5px 2.5px",
          mixBlendMode: "multiply",
        }}
      />
      <span className="relative">{label}</span>
      <span aria-hidden className="relative font-sans text-xs leading-none">
        →
      </span>
    </motion.a>
  );
}

// Client-side navigation into a full room page (/store, /work, /events). The
// shelf cards and each room's "Enter" button use this so a click opens the full
// browsing experience, while the couch icons (handled in BottomMenu) scrub the
// camera to the room's hold inside the dive.
function useGoToRoute() {
  const router = useRouter();
  return (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    router.push(href);
  };
}

// A curated "preview shelf" that fades in — and only becomes interactive —
// while its room sits FRAMED in the dive (the "arrival" beat). It never
// overlaps the fast/blurred motion, so the user only ever clicks a settled,
// still target. The assets are real, data-driven components (not baked into
// the photo), so they deep-link into the actual Store / Work sections and
// degrade gracefully.
function RoomOverlay({
  progress,
  band,
  kicker,
  enterLabel,
  enterHref,
  enterVariant,
  wide = false,
  children,
}: {
  progress: MotionValue<number>;
  band: Band;
  kicker: string;
  enterLabel: string;
  enterHref: string;
  enterVariant: "filled" | "outline";
  wide?: boolean;
  children: React.ReactNode;
}) {
  const goToRoute = useGoToRoute();
  // The band represents travel toward the room shown at its final frame. Reveal
  // during that final approach, remain settled throughout the arrival hold,
  // then clear quickly as travel toward the next destination begins.
  const playSpan = band.playEnd - band.start;
  const revealStart = band.start + playSpan * 0.78;
  const revealEnd = band.start + playSpan * 0.94;
  const clearEnd = Math.min(1, band.end + 0.022);
  const opacity = useTransform(
    progress,
    [revealStart, revealEnd, band.end, clearEnd],
    [0, 1, 1, 0]
  );
  const y = useTransform(opacity, (o) => (1 - o) * 26);
  const pointer = useTransform(opacity, (o) => (o > 0.6 ? "auto" : "none"));

  return (
    <motion.div
      style={{
        opacity,
        bottom:
          "calc(env(safe-area-inset-bottom, 0px) + var(--bottom-menu-h, 190px) + 1rem)",
      }}
      className="pointer-events-none fixed left-3 right-[4.75rem] z-20 flex flex-col items-stretch gap-3 sm:inset-x-0 sm:items-center sm:px-4"
    >
      {/* legibility scrim so labels read over the room photo */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-[42vh]"
        style={{
          background:
            "linear-gradient(to top, rgba(8,6,5,0.8) 0%, rgba(8,6,5,0.35) 45%, transparent 100%)",
        }}
      />
      <motion.div
        style={{ y, pointerEvents: pointer }}
        className={`flex w-full flex-col items-stretch gap-3 sm:items-center ${wide ? "sm:max-w-5xl" : "sm:max-w-3xl"}`}
      >
        <span className="self-center text-center font-mono text-[0.55rem] uppercase tracking-[0.42em] text-[var(--color-bone)]/70">
          {kicker}
        </span>
        <div className="w-full">{children}</div>
        <HardButton
          href={enterHref}
          label={enterLabel}
          variant={enterVariant}
          rotation={-0.8}
          onClick={goToRoute(enterHref)}
        />
      </motion.div>
    </motion.div>
  );
}

function JourneyStoreIndex({ products }: { products: Product[] }) {
  const featuredProducts = products.slice(0, 3);
  if (!featuredProducts.length) return null;

  return (
    <div className="grid grid-cols-3 gap-px border border-white/20 bg-white/20 shadow-[7px_8px_0_rgba(0,0,0,0.5)]">
      {featuredProducts.map((product, index) => (
        <Link
          key={product.id}
          href={`/store/${product.id}`}
          className="group relative aspect-[4/5] overflow-hidden bg-black/85 text-[var(--color-bone)]"
        >
          {product.image && (
            <Image
              src={product.image.url}
              alt={product.image.alt}
              fill
              sizes="(min-width: 640px) 22rem, 28vw"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
            />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
          <span className="absolute left-2 top-2 font-mono text-[0.4rem] uppercase tracking-[0.14em] text-white/70 sm:left-4 sm:top-4 sm:text-[0.52rem] sm:tracking-[0.2em]">
            {index === 0 ? "Featured · " : ""}{product.code}
          </span>
          <span className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4">
            <strong className="block text-[0.62rem] leading-tight text-white sm:text-lg">{product.name}</strong>
            <span className="mt-1 flex items-center justify-between font-mono text-[0.4rem] uppercase tracking-[0.1em] text-white/65 sm:mt-2 sm:text-[0.52rem] sm:tracking-[0.16em]">
              <span>{product.price}</span><span className="transition-transform group-hover:translate-x-1">↗</span>
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function JourneyWorkIndex({ projects }: { projects: Project[] }) {
  const featuredProjects = projects.slice(0, 3);
  if (!featuredProjects.length) return null;

  return (
    <div className="grid grid-cols-3 gap-px border border-white/20 bg-white/20 shadow-[7px_8px_0_rgba(0,0,0,0.5)]">
      {featuredProjects.map((project, index) => (
        <Link
          key={project.no}
          href={`/work/${projectSlug(project)}`}
          className="group relative aspect-[4/5] overflow-hidden bg-[#17130f] text-[var(--color-bone)]"
        >
          {project.image && (
            <Image
              src={project.image}
              alt={project.title}
              fill
              sizes="(min-width: 640px) 22rem, 28vw"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
            />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
          <span className="absolute left-2 top-2 font-mono text-[0.4rem] uppercase tracking-[0.14em] text-white/70 sm:left-4 sm:top-4 sm:text-[0.52rem] sm:tracking-[0.2em]">
            {index === 0 ? "Featured · " : ""}RU / {project.no}
          </span>
          <span className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4">
            <strong className="block text-[0.62rem] leading-tight text-white sm:text-lg">{project.title}</strong>
            <span className="mt-1 flex items-center justify-between font-mono text-[0.4rem] uppercase tracking-[0.1em] text-white/65 sm:mt-2 sm:text-[0.52rem] sm:tracking-[0.16em]">
              <span>{project.medium} · {project.year}</span><span className="transition-transform group-hover:translate-x-1">↗</span>
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function JourneyAboutIndex() {
  return (
    <div className="grid min-h-32 grid-cols-[1.15fr_0.85fr] gap-px border border-white/20 bg-white/20 shadow-[5px_6px_0_rgba(0,0,0,0.45)] sm:min-h-40 sm:grid-cols-[1.4fr_1fr_1fr]">
      <Link href="/about" className="group relative row-span-2 overflow-hidden bg-black/85">
        <Image src="/ruined-hero-lounge.jpg" alt="The lounge at Studio No. 17" fill sizes="(min-width: 640px) 20rem, 55vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.02]" />
        <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/10" />
        <span className="absolute left-2 top-2 font-mono text-[0.46rem] uppercase tracking-[0.18em] text-white/60 sm:left-3 sm:top-3">Studio No. 17</span>
        <span className="absolute bottom-2 left-2 right-2 sm:bottom-3 sm:left-3 sm:right-3">
          <strong className="block text-sm leading-none text-white sm:text-lg">What remains, remains.</strong>
          <span className="mt-1 block font-mono text-[0.46rem] uppercase tracking-[0.12em] text-white/55">Practice / Utah / MMXXVI</span>
        </span>
      </Link>
      <Link href="/about" className="group relative overflow-hidden bg-black/85">
        <Image src="/art/shelf.jpg" alt="" fill sizes="16rem" className="object-cover opacity-75 transition-transform duration-700 group-hover:scale-[1.02]" />
        <span className="absolute inset-0 bg-black/25" />
        <span className="absolute bottom-2 left-2 right-2 text-[0.68rem] font-bold text-white sm:text-sm">Objects / Garments</span>
      </Link>
      <Link href="/about" className="group relative overflow-hidden bg-black/85">
        <Image src="/art/loft.jpg" alt="" fill sizes="16rem" className="object-cover opacity-75 transition-transform duration-700 group-hover:scale-[1.02]" />
        <span className="absolute inset-0 bg-black/25" />
        <span className="absolute bottom-2 left-2 right-2 text-[0.68rem] font-bold text-white sm:text-sm">Spaces / Direction</span>
      </Link>
      <Link href="/about" className="hidden items-center justify-between bg-[var(--color-signal)] px-3 font-mono text-[0.48rem] uppercase tracking-[0.16em] text-black sm:col-span-2 sm:flex"><span>About the studio</span><span>→</span></Link>
    </div>
  );
}

function JourneyEventsIndex({ events }: { events: StudioEvent[] }) {
  return (
    <div className="border border-white/20 bg-black/82 shadow-[5px_6px_0_rgba(0,0,0,0.45)] backdrop-blur-sm">
      {events.slice(0, 3).map((event, index) => (
        <Link key={event.id} href="/events" className="group grid grid-cols-[2.4rem_1fr_auto] items-center gap-2 border-b border-white/15 px-2.5 py-2 text-[var(--color-bone)] last:border-b-0 sm:grid-cols-[3.5rem_1fr_10rem_auto] sm:px-4 sm:py-3">
          <span className="font-mono text-[0.44rem] tracking-[0.16em] text-white/35">0{index + 1}</span>
          <span>
            <strong className="block text-[0.68rem] leading-tight sm:text-sm">{event.title}</strong>
            <span className="mt-0.5 block font-mono text-[0.42rem] uppercase tracking-[0.12em] text-white/45 sm:hidden">{event.date}</span>
          </span>
          <span className="hidden font-mono text-[0.46rem] uppercase tracking-[0.14em] text-white/45 sm:block">{event.date}</span>
          <span className="font-mono text-[0.48rem] text-[var(--color-poster)] transition-transform group-hover:translate-x-1">↗</span>
        </Link>
      ))}
    </div>
  );
}

function AfterTheFear({
  progress,
  start = 0.6,
  end = 1.0,
}: {
  progress: ReturnType<typeof useSpring>;
  start?: number;
  end?: number;
}) {
  const span = end - start;
  const at = (f: number) => start + f * span;

  // Words fade in early, then the amber spotlight walks down them one at a
  // time. Onsets are spaced ~0.24 of the span apart (was ~0.125) with a long
  // hold on each, so the sequence reads slowly instead of flashing past.
  const appearOpacity = useTransform(progress, [at(0), at(0.25)], [0, 1]);
  const appearY = useTransform(progress, [at(0), at(0.25)], [18, 0]);

  const BONE = "rgba(229,224,213,1)";
  const HAZARD = "rgba(245,197,24,1)";
  const CUT = 0.001;
  const aColor = useTransform(
    progress,
    [at(0.32) - CUT, at(0.32), at(0.52), at(0.52) + CUT],
    [BONE, HAZARD, HAZARD, BONE]
  );
  const tColor = useTransform(
    progress,
    [at(0.56) - CUT, at(0.56), at(0.76), at(0.76) + CUT],
    [BONE, HAZARD, HAZARD, BONE]
  );
  const fColor = useTransform(progress, [at(0.8) - CUT, at(0.8)], [BONE, HAZARD]);

  // Footer credit fades up once the words have landed and the spotlight is
  // walking through them.
  const footerOpacity = useTransform(progress, [at(0.62), at(0.9)], [0, 1]);
  const footerY = useTransform(progress, [at(0.62), at(0.9)], [10, 0]);

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 sm:gap-2 pointer-events-none select-none px-6"
    >
      <motion.span
        style={{ opacity: appearOpacity, y: appearY, color: aColor }}
        className="display uppercase leading-[0.85] text-[clamp(2.75rem,13vw,8rem)] tracking-tight"
      >
        After
      </motion.span>
      <motion.span
        style={{ opacity: appearOpacity, y: appearY, color: tColor }}
        className="display uppercase leading-[0.85] text-[clamp(2.75rem,13vw,8rem)] tracking-tight"
      >
        The
      </motion.span>
      <motion.span
        style={{ opacity: appearOpacity, y: appearY, color: fColor }}
        className="display italic uppercase leading-[0.85] text-[clamp(2.75rem,13vw,8rem)] tracking-tight"
      >
        Fear
      </motion.span>

      {/* technical streetwear colophon — pinned to the bottom, clear of the couch */}
      <motion.div
        style={{
          opacity: footerOpacity,
          y: footerY,
          bottom:
            "calc(env(safe-area-inset-bottom, 0px) + var(--bottom-menu-h, 190px) + 1rem)",
        }}
        className="pointer-events-auto absolute inset-x-0 px-5 sm:px-8 text-[var(--color-bone)]"
      >
        {/* registration rule */}
        <div className="mb-2 flex items-center gap-3 text-[var(--color-bone)]/40">
          <span className="font-mono text-[0.6rem] leading-none">⊕</span>
          <span className="h-px flex-1 bg-[var(--color-bone)]/20" />
          <span className="font-mono text-[0.5rem] tracking-[0.34em] uppercase text-[var(--color-bone)]/55">
            RU // AW26
          </span>
          <span className="h-px flex-1 bg-[var(--color-bone)]/20" />
          <span className="font-mono text-[0.6rem] leading-none">⊕</span>
        </div>

        {/* technical credit */}
        <div className="grid grid-cols-2 items-end gap-2 font-mono text-[0.46rem] sm:text-[0.55rem] tracking-[0.16em] sm:tracking-[0.22em] uppercase text-[var(--color-bone)]/55">
          <div className="space-y-0.5 text-left">
            <div className="text-[var(--color-bone)]/80">© 2026</div>
            <div>The Ruined Project</div>
            <div className="text-[var(--color-bone)]/35">All rights reserved</div>
          </div>

          <div className="space-y-0.5 text-right">
            <div>40.4633° N</div>
            <div>111.7780° W</div>
            <div className="text-[var(--color-bone)]/35">Created without permission</div>
          </div>
        </div>
        <nav aria-label="Closing links" className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 font-mono text-[0.52rem] uppercase tracking-[0.22em] text-[var(--color-bone)]/75">
          <Link className="hover:text-white" href="/store">Store</Link>
          <Link className="hover:text-white" href="/work">Work</Link>
          <Link className="hover:text-white" href="/events">Events</Link>
          <Link className="hover:text-white" href="/about">About</Link>
          <Link className="hover:text-white" href="/contact">Contact</Link>
          <a className="text-[var(--color-signal)] hover:text-white" href="#top">Walk again ↺</a>
        </nav>
      </motion.div>
    </div>
  );
}

function FiresideLoop({
  progress,
  start,
}: {
  progress: MotionValue<number>;
  start: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const opacity = useTransform(progress, [start, start + 0.025], [0, 1]);

  useEffect(() => {
    let playing = false;
    const syncPlayback = (value: number) => {
      const video = videoRef.current;
      if (value >= start - 0.08) setShouldLoad(true);
      if (!video) return;
      const shouldPlay = value >= start;
      if (shouldPlay === playing) return;
      playing = shouldPlay;
      if (shouldPlay) {
        video.currentTime = 0;
        void video.play().catch(() => {});
      } else {
        video.pause();
        video.currentTime = 0;
      }
    };

    syncPlayback(progress.get());
    return progress.on("change", syncPlayback);
  }, [progress, shouldLoad, start]);

  return (
    <motion.video
      ref={videoRef}
      src={shouldLoad ? FIRESIDE_SRC : undefined}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
      style={{ opacity }}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

function ScrollHint({ progress }: { progress: ReturnType<typeof useSpring> }) {
  const opacity = useTransform(progress, [0, 0.06], [1, 0]);
  return (
    <motion.div
      style={{ opacity }}
      className="pointer-events-none fixed left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.1, duration: 0.8, ease: "easeOut" }}
      aria-hidden
    >
      <span
        className="text-[0.65rem] tracking-[0.4em] uppercase text-[var(--color-bone)]/75"
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom:
            "calc(env(safe-area-inset-bottom, 0px) + var(--bottom-menu-h, 190px) + 0.75rem)",
        }}
      >
        Scroll
        <motion.span
          className="block h-3 w-px mx-auto mt-2 bg-[var(--color-bone)]/75"
          animate={{ scaleY: [0.6, 1.4, 0.6], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
    </motion.div>
  );
}

export default function ImmersiveParallax({
  products,
}: {
  products: Product[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snappingRef = useRef(false);

  const [isDesktop, setIsDesktop] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const pointerMq = window.matchMedia("(pointer: coarse)");
    const updateMq = () => setIsDesktop(mq.matches);
    const updatePointer = () => setIsTouch(pointerMq.matches);
    updateMq();
    updatePointer();
    mq.addEventListener("change", updateMq);
    pointerMq.addEventListener("change", updatePointer);

    // Always default the homepage to the opening scene: disable browser scroll
    // restoration so reloads don't drop the user partway through the dive, and
    // force scroll to the very top on mount. Hash deep-links (e.g. /#store) are
    // still honored so BottomMenu navigation and shared links keep working.
    const hadRestoration =
      "scrollRestoration" in window.history
        ? window.history.scrollRestoration
        : null;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    if (!window.location.hash) {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !window.location.hash) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      mq.removeEventListener("change", updateMq);
      pointerMq.removeEventListener("change", updatePointer);
      window.removeEventListener("pageshow", onPageShow);
      if (hadRestoration && "scrollRestoration" in window.history) {
        window.history.scrollRestoration = hadRestoration;
      }
    };
  }, []);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });
  const p = useSpring(scrollYProgress, SCROLL_SPRING);

  // The rendered sequence: fetch the manifest once, flatten every room's frames
  // into one journey, and publish scroll progress to the shared singleton the
  // canvas reads. A poster (the first room's still) shows until the first frame
  // decodes.
  const [manifest, setManifest] = useState<SequenceManifest | null>(null);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/sequences/manifest.json", { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m: SequenceManifest | null) => {
        if (!cancelled && m) setManifest(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const bands = useMemo(
    () => (manifest ? buildSequenceBands(manifest) : {}),
    [manifest]
  );

  useEffect(() => {
    const publish = (value: number) => {
      scrollState.progress = manifest
        ? sequenceFrameProgress(value, manifest, bands)
        : clamp01(value / SEQUENCE_END);
    };
    publish(p.get());
    const unsub = p.on("change", (v) => {
      publish(v);
    });
    return () => unsub();
  }, [bands, manifest, p]);

  const frames = useMemo(
    () => (manifest ? manifest.rooms.flatMap((r) => r.files) : []),
    [manifest]
  );

  // Folder names describe where each move starts; the final frame is the next
  // destination. Panels and deep links therefore attach to these arrival holds:
  // Lobby → Store, Store → Records, Records → Lounge, Lounge → Fireside.
  const storeArrivalB = bands["lobby"];
  const worksArrivalB = bands["store"];
  const aboutArrivalB = bands["records"];
  const eventsArrivalB = FIRESIDE_EVENT_BAND;

  // Touch-only soft snap. Native momentum remains untouched while the gesture
  // is moving; once scrolling settles, nearby arrival holds gently center. The
  // threshold is roughly 15% of a room band, so a partial exploratory swipe is
  // never forced forward. The Fireside / Events target lands exactly on the
  // video handoff so its programme receives the same readable settling beat.
  useEffect(() => {
    if (
      !isTouch ||
      prefersReducedMotion ||
      !storeArrivalB ||
      !worksArrivalB ||
      !aboutArrivalB
    ) return;

    const targets = [
      ...[storeArrivalB, worksArrivalB, aboutArrivalB].map(
        (band) => band.playEnd + (band.end - band.playEnd) * 0.5
      ),
      eventsArrivalB.playEnd,
    ];
    const SNAP_THRESHOLD = 0.032;

    const settle = () => {
      snapTimerRef.current = null;
      if (snappingRef.current) return;

      const value = scrollYProgress.get();
      let target = targets[0];
      let distance = Math.abs(value - target);
      for (const candidate of targets.slice(1)) {
        const candidateDistance = Math.abs(value - candidate);
        if (candidateDistance < distance) {
          target = candidate;
          distance = candidateDistance;
        }
      }

      if (distance > SNAP_THRESHOLD || distance < 0.0015) return;
      const container = containerRef.current;
      if (!container) return;
      const scrollRange = Math.max(1, container.offsetHeight - window.innerHeight);
      const containerTop = container.getBoundingClientRect().top + window.scrollY;

      snappingRef.current = true;
      window.scrollTo({
        top: containerTop + target * scrollRange,
        behavior: "smooth",
      });
      snapTimerRef.current = setTimeout(() => {
        snappingRef.current = false;
        snapTimerRef.current = null;
      }, 520);
    };

    const queueSettle = () => {
      if (snappingRef.current) return;
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      // Fires only after touch momentum has stopped producing scroll events.
      snapTimerRef.current = setTimeout(settle, 180);
    };

    const cancelPendingSnap = () => {
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
      snappingRef.current = false;
    };

    window.addEventListener("scroll", queueSettle, { passive: true });
    window.addEventListener("touchstart", cancelPendingSnap, { passive: true });
    return () => {
      window.removeEventListener("scroll", queueSettle);
      window.removeEventListener("touchstart", cancelPendingSnap);
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
      snappingRef.current = false;
    };
  }, [
    aboutArrivalB,
    eventsArrivalB.playEnd,
    isTouch,
    prefersReducedMotion,
    scrollYProgress,
    storeArrivalB,
    worksArrivalB,
  ]);

  // The closing title begins only after every sequence frame has played. It
  // therefore never overlaps the record-store journey (or a future last room).
  const fearStart = FEAR_START;

  // Track length is tuned to the frame count so the scrub speed feels
  // deliberate but not sluggish. The synthetic push sequence is ~1/3 the frames
  // of the old video walk, so the track is shortened to match.
  // A finger swipe carries substantially more momentum than a wheel tick. Give
  // touch layouts a longer physical runway so one gesture advances a cinematic
  // beat rather than skipping most of a room.
  const trackVH = prefersReducedMotion ? 100 : isTouch || !isDesktop ? 620 : 500;
  const trackH = `${trackVH}vh`;
  const range = trackVH - 100;

  const poster = SEQUENCE_ROOMS[0].sceneSrc;

  // Scrub waypoints for the header icons.
  const waypoints: { id: string; band?: Band }[] = [
    { id: "store", band: storeArrivalB },
    { id: "work", band: worksArrivalB },
    { id: "about", band: aboutArrivalB },
    { id: "events", band: eventsArrivalB },
  ];

  return (
    <section id="top" aria-label="Hero" className="relative bg-black">
      <h1 className="sr-only">Ruined — objects, garments, spaces, and projects after the fear</h1>
      <div ref={containerRef} className="relative" style={{ height: trackH }}>
        <div className="sticky top-0 h-screen w-full overflow-hidden bg-black">
          <motion.div
            className="absolute inset-0"
            // Keep the server-rendered poster visible. Starting this wrapper at
            // opacity 0 makes the entire hero permanently black whenever the
            // client bundle is slow, cached incorrectly, or fails to hydrate.
            initial={false}
          >
            {/* Poster (first room's still) — shown until the first frame decodes,
                and as the universal fallback if no sequence has been built yet. */}
            <picture className="block h-full w-full">
              <source srcSet={poster.replace(/\.jpg$/i, ".avif")} type="image/avif" />
              <source srcSet={poster.replace(/\.jpg$/i, ".webp")} type="image/webp" />
              <img
                src={poster}
                alt=""
                draggable={false}
                fetchPriority="high"
                decoding="async"
                className={`absolute inset-0 h-full w-full object-cover select-none transition-opacity duration-700 ${
                  ready ? "opacity-0" : "opacity-100"
                }`}
              />
            </picture>

            {!prefersReducedMotion && frames.length > 0 && (
              <RoomSequenceCanvas frames={frames} onReady={onReady} />
            )}

            {!prefersReducedMotion && <FiresideLoop progress={p} start={SEQUENCE_END} />}

            {prefersReducedMotion && (
              <nav
                aria-label="Explore Ruined"
                className="absolute inset-x-6 bottom-32 z-20 grid grid-cols-2 gap-2 text-center font-mono text-[0.6rem] uppercase tracking-[0.18em] text-[var(--color-bone)] sm:left-1/2 sm:right-auto sm:w-[40rem] sm:-translate-x-1/2 sm:grid-cols-4"
              >
                <Link className="border border-white/50 bg-black/60 px-3 py-3" href="/store">Store</Link>
                <Link className="border border-white/50 bg-black/60 px-3 py-3" href="/work">Work</Link>
                <Link className="border border-white/50 bg-black/60 px-3 py-3" href="/about">About</Link>
                <Link className="border border-white/50 bg-black/60 px-3 py-3" href="/events">Events</Link>
              </nav>
            )}
          </motion.div>

          {/* "After / The / Fear" rises over the final room's tail and the
              spotlight sweeps the word-by-word finish. */}
          {!prefersReducedMotion && <AfterTheFear progress={p} start={fearStart} end={1.0} />}
        </div>

        {/* Invisible scrub waypoints. Each spans its room's band, so a couch
            icon's anchor jump (BottomMenu → scrollIntoView #id) lands the walk in
            that room and the active-icon tracker lights while it's on screen.
            Rendered always (with default positions) so BottomMenu's observer
            binds them on mount; positions refine once the manifest loads. */}
        {waypoints.map(({ id, band }) => (
          <span
            key={id}
            id={id}
            aria-hidden
            className="pointer-events-none absolute left-0 w-px"
            style={{
              // Deep links land on the held arrival frame with its panel fully
              // visible, rather than at the start of the preceding camera move.
              top: `${(band ? band.playEnd : 0.99) * range}vh`,
              height: `${(band ? Math.max(band.end - band.playEnd, 0.01) : 0.01) * range}vh`,
            }}
          />
        ))}
      </div>

      <ScrollHint progress={p} />

      {/* As each room passes through frame, a curated shelf of REAL, data-driven
          assets fades in and becomes clickable — apparel in the store, project
          "records" in the hub — deep-linking into the actual sections. Each is
          shown only once its room's sequence exists. */}
      {!prefersReducedMotion && storeArrivalB && storeArrivalB.count > 0 && (
        <RoomOverlay
          progress={p}
          band={storeArrivalB}
          kicker="——  the store · select pieces  ——"
          enterLabel="Enter the store"
          enterHref="/store"
          enterVariant="filled"
          wide
        >
          <JourneyStoreIndex products={products} />
        </RoomOverlay>
      )}
      {!prefersReducedMotion && worksArrivalB && worksArrivalB.count > 0 && (
        <RoomOverlay
          progress={p}
          band={worksArrivalB}
          kicker="——  project hub · recent records  ——"
          enterLabel="Open the project hub"
          enterHref="/work"
          enterVariant="outline"
          wide
        >
          <JourneyWorkIndex projects={PROJECTS} />
        </RoomOverlay>
      )}
      {!prefersReducedMotion && aboutArrivalB && aboutArrivalB.count > 0 && (
        <RoomOverlay
          progress={p}
          band={aboutArrivalB}
          kicker="——  studio · what survives  ——"
          enterLabel="About the studio"
          enterHref="/about"
          enterVariant="outline"
        >
          <JourneyAboutIndex />
        </RoomOverlay>
      )}
      {!prefersReducedMotion && eventsArrivalB && eventsArrivalB.count > 0 && (
        <RoomOverlay
          progress={p}
          band={eventsArrivalB}
          kicker="——  studio programme · upcoming  ——"
          enterLabel="View all events"
          enterHref="/events"
          enterVariant="outline"
        >
          <JourneyEventsIndex events={EVENTS} />
        </RoomOverlay>
      )}
    </section>
  );
}
