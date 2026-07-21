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
import { PRODUCT_TONES, type Product } from "@/data/products";
import { PROJECTS, type Project } from "@/data/projects";
import { SLEEVE, ACCENT } from "@/components/sections/RecordCarousel";
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

// Client-side navigation into a full room page (/store, /work, /about). The
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
  children,
}: {
  progress: MotionValue<number>;
  band: Band;
  kicker: string;
  enterLabel: string;
  enterHref: string;
  enterVariant: "filled" | "outline";
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
      className="pointer-events-none fixed inset-x-0 z-20 flex flex-col items-center gap-3 px-4"
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
        className="flex flex-col items-center gap-3"
      >
        <span className="font-mono text-[0.55rem] tracking-[0.42em] uppercase text-[var(--color-bone)]/70">
          {kicker}
        </span>
        <div className="flex items-end justify-center gap-2.5 sm:gap-3.5">
          {children}
        </div>
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

function ProductCard({ product }: { product: Product }) {
  const goToRoute = useGoToRoute();
  return (
    <motion.a
      href="/store"
      onClick={goToRoute("/store")}
      whileHover={{ y: -5 }}
      transition={{ type: "spring", stiffness: 360, damping: 24 }}
      className="group block no-underline select-none w-[clamp(64px,17vw,118px)]"
    >
      <div
        className="relative aspect-[3/4] w-full overflow-hidden"
        style={{
          background: PRODUCT_TONES[product.tone],
          border: "1px solid rgba(229,224,213,0.18)",
          boxShadow: "4px 5px 0 0 rgba(8,6,5,0.55)",
        }}
      >
        {product.image && (
          <Image
            src={product.image.url}
            alt=""
            fill
            sizes="(min-width: 640px) 118px, 17vw"
            className="object-cover"
          />
        )}
        <span
          aria-hidden
          className="absolute left-1.5 top-1.5 font-mono text-[0.5rem] tracking-[0.12em] text-[var(--color-bone)]/55"
        >
          {product.code}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-1">
        <span className="font-mono text-[0.5rem] tracking-[0.08em] uppercase text-[var(--color-bone)]/85 truncate">
          {product.name}
        </span>
        <span className="font-mono text-[0.5rem] text-[var(--color-bone)]/55 whitespace-nowrap">
          {product.price}
        </span>
      </div>
    </motion.a>
  );
}

function RecordCard({ project }: { project: Project }) {
  const goToRoute = useGoToRoute();
  return (
    <motion.a
      href="/work"
      onClick={goToRoute("/work")}
      whileHover={{ y: -5 }}
      transition={{ type: "spring", stiffness: 360, damping: 24 }}
      className="group block no-underline select-none w-[clamp(72px,19vw,132px)]"
    >
      <div
        className="relative aspect-square w-full overflow-hidden"
        style={{
          background: SLEEVE[project.tone],
          border: "1px solid rgba(229,224,213,0.16)",
          boxShadow: "4px 5px 0 0 rgba(8,6,5,0.55)",
        }}
      >
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[3px]"
          style={{ background: ACCENT[project.tone] }}
        />
        <span className="absolute left-2.5 top-2 font-mono text-[0.5rem] tracking-[0.12em] text-[var(--color-bone)]/55">
          {project.no}
        </span>
        <span className="absolute bottom-2 left-2.5 right-2 display text-[0.72rem] leading-[0.95] uppercase text-[var(--color-bone)]/90">
          {project.title}
        </span>
      </div>
      <span className="mt-1.5 block font-mono text-[0.5rem] tracking-[0.1em] uppercase text-[var(--color-bone)]/55">
        {project.medium}
      </span>
    </motion.a>
  );
}

// Placeholder artworks for the lounge / "about" beat — high-colour, abstract,
// conceptual, deliberately vivid to contrast the warm industrial building.
// Stand-ins to be swapped for the original art later (drop a real image `src`
// onto each).
type ArtPiece = { id: string; title: string; medium: string; art: string };
const ABOUT_ART: ArtPiece[] = [
  {
    id: "art-1",
    title: "Combustion",
    medium: "Acrylic on canvas",
    art: "radial-gradient(120% 120% at 30% 20%, #ffd54a 0%, #f5511e 38%, #c2185b 66%, #2a0a3a 100%)",
  },
  {
    id: "art-2",
    title: "Signal / Noise",
    medium: "Pigment · resin",
    art: "radial-gradient(130% 130% at 70% 30%, #34e0d8 0%, #1f6feb 42%, #7b2ff7 72%, #0a0820 100%)",
  },
  {
    id: "art-3",
    title: "Verdigris Bloom",
    medium: "Mixed media",
    art: "radial-gradient(120% 120% at 40% 80%, #b6f24a 0%, #2dbd6e 40%, #1f6feb 70%, #19103a 100%)",
  },
];

function ArtCard({ piece }: { piece: ArtPiece }) {
  const goToRoute = useGoToRoute();
  return (
    <motion.a
      href="/about"
      onClick={goToRoute("/about")}
      whileHover={{ y: -5 }}
      transition={{ type: "spring", stiffness: 360, damping: 24 }}
      className="group block no-underline select-none w-[clamp(76px,20vw,142px)]"
    >
      <div
        className="relative aspect-[4/5] w-full overflow-hidden"
        style={{
          background: piece.art,
          border: "1px solid rgba(229,224,213,0.28)",
          boxShadow: "4px 5px 0 0 rgba(8,6,5,0.55)",
        }}
      >
        {/* thin inner frame so the plate reads as a hung canvas */}
        <span
          aria-hidden
          className="absolute inset-[6px] border border-[rgba(8,6,5,0.22)]"
        />
      </div>
      <div className="mt-1.5">
        <span className="block font-mono text-[0.5rem] tracking-[0.08em] uppercase text-[var(--color-bone)]/85 truncate">
          {piece.title}
        </span>
        <span className="block font-mono text-[0.5rem] tracking-[0.1em] uppercase text-[var(--color-bone)]/50">
          {piece.medium}
        </span>
      </div>
    </motion.a>
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

  const [isDesktop, setIsDesktop] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const updateMq = () => setIsDesktop(mq.matches);
    updateMq();
    mq.addEventListener("change", updateMq);

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
    fetch("/sequences/manifest.json", { cache: "no-store" })
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
  // Lobby → Store, Store → Records, Records → Lounge.
  const storeArrivalB = bands["lobby"];
  const worksArrivalB = bands["store"];
  const aboutArrivalB = bands["records"];
  // The closing title begins only after every sequence frame has played. It
  // therefore never overlaps the record-store journey (or a future last room).
  const fearStart = FEAR_START;

  // Track length is tuned to the frame count so the scrub speed feels
  // deliberate but not sluggish. The synthetic push sequence is ~1/3 the frames
  // of the old video walk, so the track is shortened to match.
  const trackVH = prefersReducedMotion ? 100 : isDesktop ? 500 : 445;
  const trackH = `${trackVH}vh`;
  const range = trackVH - 100;

  const poster = SEQUENCE_ROOMS[0].sceneSrc;

  // Scrub waypoints for the couch icons (BottomMenu reads ids store/work/about).
  const waypoints: { id: string; band?: Band }[] = [
    { id: "store", band: storeArrivalB },
    { id: "work", band: worksArrivalB },
    { id: "about", band: aboutArrivalB },
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
                className="absolute inset-x-6 bottom-32 z-20 grid grid-cols-3 gap-2 text-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-[var(--color-bone)] sm:left-1/2 sm:right-auto sm:w-[34rem] sm:-translate-x-1/2"
              >
                <Link className="border border-white/50 bg-black/60 px-3 py-3" href="/store">Store</Link>
                <Link className="border border-white/50 bg-black/60 px-3 py-3" href="/work">Work</Link>
                <Link className="border border-white/50 bg-black/60 px-3 py-3" href="/about">About</Link>
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
        >
          {products.slice(0, 4).map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
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
        >
          {PROJECTS.slice(0, 4).map((project) => (
            <RecordCard key={project.no} project={project} />
          ))}
        </RoomOverlay>
      )}
      {!prefersReducedMotion && aboutArrivalB && aboutArrivalB.count > 0 && (
        <RoomOverlay
          progress={p}
          band={aboutArrivalB}
          kicker="——  about · selected works  ——"
          enterLabel="About the studio"
          enterHref="/about"
          enterVariant="outline"
        >
          {ABOUT_ART.map((piece) => (
            <ArtCard key={piece.id} piece={piece} />
          ))}
        </RoomOverlay>
      )}
    </section>
  );
}
