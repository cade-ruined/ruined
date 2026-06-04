"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
// Re-encoded from the original 8.5MB PNG to AVIF (~300KB) + WebP (~460KB)
// fallback (see scripts/optimize-images.mjs). Native resolution is kept so
// the parallax push-in stays sharp; only the byte weight changed.
import warehouseAvif from "@/imports/web-main-bg.avif";
import warehouseWebp from "@/imports/web-main-bg.webp";
import SheetVideo from "./SheetVideo";

// Hero background as a <picture> so modern browsers pull AVIF and the rest
// fall back to WebP — the 8.5MB source PNG is never shipped. fetchPriority
// high + eager because this is the LCP element.
function WarehouseImage() {
  return (
    <picture>
      <source srcSet={warehouseAvif.src} type="image/avif" />
      <source srcSet={warehouseWebp.src} type="image/webp" />
      <img
        src={warehouseWebp.src}
        alt=""
        draggable={false}
        fetchPriority="high"
        decoding="async"
        className="block w-full h-full select-none"
      />
    </picture>
  );
}

const IMG_W = 6688;
const IMG_H = 3764;
const IMG_ASPECT = IMG_W / IMG_H;

// Keyframes describing the cinematic journey across the warehouse.
// Pos 1 (wide) → Pos 2 (sheet 1) → Pos 3 (sheet 2, raised to clear couch)
// → fade down into black.
//
// The landmark beats (the old "holds" at 0.18→0.42 and 0.58→0.82) no
// longer FREEZE the camera — instead each one carries a slow, continuous
// push-in (a gentle dolly), so something is always moving under the
// scroll. The pan anchors (SX/SY) stay put across each beat to keep the
// sheet framed, while SC keeps creeping forward. Fast arrival → slow
// lingering push → fast travel → slow push → fade-and-pan-down reads as
// a deliberate, premium cadence rather than start/stop jitter.
const STOPS = [0, 0.18, 0.42, 0.58, 0.82, 1] as const;
const SX = [0.75, 0.49, 0.49, 0.67, 0.67, 0.67] as const; // horizontal pan
const SY = [0, 0.01, 0.04, 0.3, 0.33, 1.2] as const; // vertical pan (slight drift in holds)
const SC = [1, 1.7, 1.82, 2.0, 2.12, 2.16] as const; // scale (slow push through holds + fade)
const OP = [1, 1, 1, 1, 1, 0] as const; // opacity

// Desktop journey (landscape). The mobile model pans by exploiting the
// horizontal overflow of a tall image inside a portrait viewport — but
// on a ~16:9 desktop the warehouse photo (≈16:9) basically fills the
// screen, so there's no overflow to pan and the tour collapses. Instead
// the desktop branch uses a scale-aware FOCAL-POINT model: at each stop
// we center a target point of the image (DFX/DFY, as 0..1 fractions of
// the photo) at a given zoom (DDS). Same cinematic beats as mobile —
// wide establishing → Sheet 1 ("Yesterday", x≈0.49) → Sheet 2 (the video
// banner, x≈0.627) → fade-and-drift-down — with slow push-ins through
// the holds so the camera is never frozen.
// Seven beats: wide → Sheet 1 (+ hold) → Sheet 2 (+ hold) → fade to
// black → a long BLACK HOLD (0.63 → 1.0, ~37% of the journey) dedicated
// to the "After The Fear" line, so that beat reads slowly and tactilely
// instead of flashing by. The black-hold focal/zoom are frozen since the
// (now-invisible) photo no longer matters.
const DSTOPS = [0, 0.11, 0.3, 0.43, 0.55, 0.63, 1] as const;
const DFX = [0.5, 0.49, 0.49, 0.627, 0.627, 0.627, 0.627] as const; // focal x
const DFY = [0.5, 0.32, 0.33, 0.33, 0.35, 0.62, 0.62] as const; // focal y
const DDS = [1.0, 1.85, 1.95, 2.1, 2.2, 2.3, 2.3] as const; // zoom
const DOP = [1, 1, 1, 1, 1, 0, 0] as const; // opacity (fade 0.55→0.63, then black)

// Scroll-linked spring. The old config (72 / 26 / 1.0) had a low natural
// frequency (~8.5 rad/s), so the image visibly trailed the scroll wheel —
// the "floaty / laggy" feel. This roughly doubles the natural frequency
// (~17 rad/s) so the camera tracks the scroll closely, and stays
// over-damped (ratio ~1.6) so there's zero overshoot or bounce — the
// responsive-but-smooth cadence used by Lenis/Locomotive-style sites.
const SCROLL_SPRING = {
  stiffness: 150,
  damping: 28,
  mass: 0.5,
  restDelta: 0.0005,
} as const;

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
      // pointer-events are gated by the SheetCTA wrapper (per-stamp), so a
      // faded/hidden stamp can't be tapped as a ghost target.
      className="relative flex items-center justify-between gap-2 px-4 py-3 font-mono text-[0.55rem] tracking-[0.18em] uppercase no-underline select-none whitespace-nowrap"
      style={{
        rotate: rotation,
        background: isFilled ? "var(--color-poster)" : "var(--color-bone)",
        color: isFilled ? "var(--color-bone)" : "var(--color-faded)",
        border: "1.5px solid var(--color-faded)",
        boxShadow: "5px 5px 0 0 var(--color-faded)",
      }}
    >
      {/* Hard grain — a printed-ink dot pattern over the swatch so the
          button reads like a label stuck on a warehouse wall instead of
          a glossy web button. */}
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

function SheetCTA({
  progress,
  holdStart,
  holdEnd,
  liftVh = 10,
}: {
  progress: ReturnType<typeof useSpring>;
  /** Scroll progress at which this sheet's "hold" beat begins (STOPS[i]). */
  holdStart: number;
  /** Scroll progress at which the hold ends (STOPS[i+1]). */
  holdEnd: number;
  /** How far (in vh) to lift the stamps above the couch menu. Lower = the
   *  stamps sit closer to the menu. Defaults to 10vh (the mobile spot);
   *  desktop sheets pass smaller values to drop them down the banner. */
  liftVh?: number;
}) {
  // Staggered, scroll-driven reveal: the two stamps no longer pop in
  // together. As the user scrolls onto the sheet, "See details" slides
  // up first; "Latest projects" follows a beat later — so something is
  // always entering the frame during the beat instead of one simultaneous
  // flash. Both clear out together as the camera pushes on to the next
  // sheet. Windows are expressed relative to the hold so the same shape
  // works for every sheet; only the anchors move.
  const span = holdEnd - holdStart;

  // First stamp: arrives as the sheet settles into frame.
  const b1FadeIn = holdStart - 0.03;
  const b1In = holdStart + span * 0.16;
  // Second stamp: a deliberate beat later, mid-hold.
  const b2FadeIn = holdStart + span * 0.32;
  const b2In = holdStart + span * 0.52;
  // Both exit together as the camera departs for the next beat.
  const settledOut = holdEnd - 0.03;
  const fadeOut = holdEnd + 0.04;

  const b1Opacity = useTransform(
    progress,
    [b1FadeIn, b1In, settledOut, fadeOut],
    [0, 1, 1, 0]
  );
  const b1Y = useTransform(progress, [b1FadeIn, b1In], [26, 0]);
  const b2Opacity = useTransform(
    progress,
    [b2FadeIn, b2In, settledOut, fadeOut],
    [0, 1, 1, 0]
  );
  const b2Y = useTransform(progress, [b2FadeIn, b2In], [26, 0]);

  // Disable interaction per-stamp once it's faded so a tap on empty space
  // mid-parallax can't hit a ghost target. The HardButton no longer forces
  // pointer-events itself, so these wrappers fully gate it.
  const b1Pointer = useTransform(b1Opacity, (o) => (o > 0.5 ? "auto" : "none"));
  const b2Pointer = useTransform(b2Opacity, (o) => (o > 0.5 ? "auto" : "none"));

  const goTo =
    (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      const el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-6"
      style={{
        // Sit at the bottom of the sheet with breathing room: clear the
        // couch menu (its actual rendered height + a 1.5rem gutter) and
        // lift another `liftVh` so the stamps land in the lower portion
        // of the sheet rather than glued to the menu. Fallback (190px)
        // covers SSR / pre-hydration before BottomMenu sets the var.
        bottom: `calc(env(safe-area-inset-bottom, 0px) + var(--bottom-menu-h, 190px) + 1.5rem + ${liftVh}vh)`,
      }}
    >
      <div className="flex flex-col items-stretch gap-2.5 w-full max-w-[11.25rem]">
        <motion.div style={{ opacity: b1Opacity, y: b1Y, pointerEvents: b1Pointer }}>
          <HardButton
            href="#store"
            label="See details"
            variant="filled"
            rotation={-1.1}
            onClick={goTo("store")}
          />
        </motion.div>
        <motion.div style={{ opacity: b2Opacity, y: b2Y, pointerEvents: b2Pointer }}>
          <HardButton
            href="#work"
            label="Latest projects"
            variant="outline"
            rotation={0.7}
            onClick={goTo("work")}
          />
        </motion.div>
      </div>
    </div>
  );
}

function AfterTheFear({
  progress,
  start = 0.84,
  end = 1.0,
}: {
  progress: ReturnType<typeof useSpring>;
  /** Scroll progress where the line begins to appear. */
  start?: number;
  /** Scroll progress where the last word locks lit. */
  end?: number;
}) {
  // Every beat is expressed as a fraction of the [start, end] window, so
  // the whole sequence can be stretched over more (or less) scroll
  // without retuning the internal cadence. Defaults (0.84 → 1.0)
  // reproduce the original mobile timing exactly; the desktop branch
  // passes a much wider window so the line reads slowly and tactilely.
  const span = end - start;
  const at = (f: number) => start + f * span;

  // The line holds back until the warehouse photo is well into its
  // fade-out, so the words rise into an already-darkening frame instead
  // of landing on a still-vivid one. All three words share a single
  // appear window — they fade up together as one breath.
  const appearOpacity = useTransform(progress, [at(0), at(0.375)], [0, 1]);
  const appearY = useTransform(progress, [at(0), at(0.375)], [18, 0]);

  // Once the line is present, continued scrolling sweeps a single
  // hazard-yellow spotlight down the column — After, then The, then
  // Fear. Only ONE word is lit at a time, and the change is a HARD CUT
  // (no fade): each word holds bone, snaps to hazard across its window,
  // then snaps back to bone the instant the next word ignites. CUT is
  // the tiny progress epsilon used for the snap — small enough that the
  // spring sweeps through it almost instantly, reading as an on/off
  // switch rather than a crossfade. Fear is the closing beat, so it
  // snaps lit and holds to the end.
  const BONE = "rgba(229,224,213,1)";
  const HAZARD = "rgba(245,197,24,1)";
  const CUT = 0.001;
  // Lit windows are disjoint and meet at a shared bone instant (prev
  // word's snap-back edge == next word's snap-up edge), so two words
  // are never lit simultaneously.
  const aColor = useTransform(
    progress,
    [at(0.4375) - CUT, at(0.4375), at(0.55), at(0.55) + CUT],
    [BONE, HAZARD, HAZARD, BONE]
  );
  const tColor = useTransform(
    progress,
    [at(0.5625) - CUT, at(0.5625), at(0.675), at(0.675) + CUT],
    [BONE, HAZARD, HAZARD, BONE]
  );
  const fColor = useTransform(
    progress,
    [at(0.6875) - CUT, at(0.6875)],
    [BONE, HAZARD]
  );

  return (
    <div
      aria-hidden
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
    </div>
  );
}

function ScrollHint({ progress }: { progress: ReturnType<typeof useSpring> }) {
  // Hint fades out very early in the journey.
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
          // Sit just above the couch menu using its actual measured height
          // (published as --bottom-menu-h by BottomMenu). Fallback matches
          // the menu's nominal size at full scale.
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

export default function ImmersiveParallax() {
  const containerRef = useRef<HTMLDivElement>(null);

  const [isDesktop, setIsDesktop] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const updateMq = () => setIsDesktop(mq.matches);
    const updateDims = () =>
      setDims({ w: window.innerWidth, h: window.innerHeight });
    updateMq();
    updateDims();
    setReady(true);
    mq.addEventListener("change", updateMq);
    window.addEventListener("resize", updateDims);

    // Always default the homepage to Position 1 (RUINED on the pillar):
    // disable browser scroll restoration so reloads don't drop the user
    // partway through the parallax journey, and force scroll to the very
    // top on mount. Hash deep-links (e.g. /#store) are still honored so
    // BottomMenu navigation and shared links keep working.
    const hadRestoration =
      "scrollRestoration" in window.history
        ? window.history.scrollRestoration
        : null;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    if (!window.location.hash) {
      // Run on a microtask so any framework-level scroll restoration that
      // fires synchronously after mount loses the race to our reset.
      window.scrollTo(0, 0);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }

    // bfcache (Safari/Chrome back-forward): React effects don't re-run
    // when a page is restored from bfcache, so also reset on pageshow.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !window.location.hash) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      mq.removeEventListener("change", updateMq);
      window.removeEventListener("resize", updateDims);
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

  const wrapperW = dims.h * IMG_ASPECT;
  const wrapperH = dims.h;
  const overflowX = Math.max(0, wrapperW - dims.w);

  const scale = useTransform(p, [...STOPS], [...SC]);
  const opacity = useTransform(p, [...STOPS], [...OP]);
  const tx = useTransform(
    p,
    [...STOPS],
    SX.map((v) => -v * overflowX)
  );
  const ty = useTransform(
    p,
    [...STOPS],
    SY.map((v) => -v * dims.h)
  );

  // Desktop focal-point journey (see DSTOPS notes above). The image layer
  // is sized to COVER the viewport at zoom 1, then scaled about its
  // top-left while translated so the focal point (DFX/DFY) lands at
  // viewport center. We precompute the screen-space translate at each
  // stop and let useTransform interpolate it linearly (same independent
  // scale/translate interpolation the mobile path uses), which keeps the
  // photo fully covering the frame throughout the tuned journey.
  const fillByWidth = dims.h > 0 && dims.w / dims.h > IMG_ASPECT;
  const coverW = fillByWidth ? dims.w : dims.h * IMG_ASPECT;
  const coverH = fillByWidth ? dims.w / IMG_ASPECT : dims.h;

  const dScale = useTransform(p, [...DSTOPS], [...DDS]);
  const dOpacity = useTransform(p, [...DSTOPS], [...DOP]);
  const dTx = useTransform(
    p,
    [...DSTOPS],
    DDS.map((s, i) => dims.w / 2 - s * DFX[i] * coverW)
  );
  const dTy = useTransform(
    p,
    [...DSTOPS],
    DDS.map((s, i) => dims.h / 2 - s * DFY[i] * coverH)
  );

  // Avoid SSR flash with sized-to-zero wrappers, but keep the #top anchor
  // present even before hydration so deep-links and the Home tab work
  // immediately on first paint.
  //
  // NOTE: the hero deliberately omits `snap-start`. Snapping the hero would
  // fight the 600vh mobile parallax (each scroll tick would try to pull
  // back to scrollY=0) and the desktop breathing loop. Snap kicks in once
  // the user crosses into Store / Work / About, which DO carry snap-start.
  if (!ready) {
    return (
      <section
        id="top"
        aria-label="Hero"
        className="relative h-screen w-full bg-black"
      />
    );
  }

  if (isDesktop) {
    return (
      <section id="top" aria-label="Hero" className="relative bg-black">
        {/* 540vh scroll track. Trimmed from 680vh so the seven-beat tour
            doesn't feel like a slog — the dark "After The Fear" tail (last
            ~40% of the journey) still gets ~2 screens of scroll, but the
            sheet tour reaches the user in a far more standard amount of
            scrolling. */}
        <div ref={containerRef} className="relative h-[540vh]">
          <div className="sticky top-0 h-screen w-full overflow-hidden bg-black">
            <motion.div
              className="absolute top-0 left-0 will-change-transform"
              style={{
                width: coverW,
                height: coverH,
                x: dTx,
                y: dTy,
                scale: dScale,
                opacity: dOpacity,
                // Focal math is derived against a top-left origin, so the
                // translate/scale composition lands the focal point at
                // viewport center.
                transformOrigin: "0% 0%",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.2, ease: "easeOut" }}
            >
              <WarehouseImage />
              {/* Masked sheet video — mask is photo-aspect and the layer
                  is sized to cover (also photo-aspect), so it tracks the
                  focal journey and lands on Sheet 2 just like mobile. */}
              <SheetVideo src="/sheet-2.mp4" poster="/sheet-2-poster.jpg" />
            </motion.div>

            {/* "After / The / Fear" rises as the photo fades down, then
                the spotlight sweeps word-by-word across the long black
                tail. The wide [0.6, 1.0] window (vs mobile's [0.84, 1.0])
                spread over the 680vh track makes each beat slow + tactile. */}
            <AfterTheFear progress={p} start={0.6} end={1.0} />
          </div>
        </div>
        <ScrollHint progress={p} />
        {/* CTA stamps reveal one at a time on each sheet hold, matching
            the mobile cadence (anchors come from the desktop stops).
            Position 3 (Sheet 2) is framed lower on desktop, so its stamps
            drop nearly to the couch (liftVh 0) to sit in the lower banner. */}
        <SheetCTA progress={p} holdStart={DSTOPS[1]} holdEnd={DSTOPS[2]} />
        <SheetCTA
          progress={p}
          holdStart={DSTOPS[3]}
          holdEnd={DSTOPS[4]}
          liftVh={0}
        />
      </section>
    );
  }

  return (
    <section id="top" aria-label="Hero" className="relative bg-black">
      {/* 420vh: 5 distinct beats at a brisk, standard cadence (was 600vh,
          which dragged on phones). Combined with the snappier scroll
          spring, each beat now arrives without the long laggy trail. */}
      <div ref={containerRef} className="relative h-[420vh]">
        <div className="sticky top-0 h-screen w-full overflow-hidden bg-black">
          <motion.div
            className="absolute inset-0 will-change-transform"
            style={{ y: ty, scale, opacity, transformOrigin: "50% 0%" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          >
            <motion.div
              className="absolute top-0 left-0 will-change-transform"
              style={{ x: tx, width: wrapperW, height: wrapperH }}
            >
              <WarehouseImage />
              {/* The second sheet's video lives in the warehouse layer
                  itself — mask is warehouse-aspect so it pans, scales,
                  and fades along with the photograph as one scene. */}
              <SheetVideo src="/sheet-2.mp4" poster="/sheet-2-poster.jpg" />
            </motion.div>
          </motion.div>

          {/* "After / The / Fear" rises into the black as the warehouse
              photograph fades out, so the late-fade beat is never just
              an empty dark slab — there's always something animating
              under the user's scroll. Lives inside the sticky child so
              it tracks the parallax automatically and disappears when
              hero scrolls past viewport. */}
          <AfterTheFear progress={p} />
        </div>
      </div>
      <ScrollHint progress={p} />
      {/* Same stamps appear on both held sheets in the parallax — Position
          2 (the "yesterday" sheet) and Position 3 (the second sheet). Both
          render in the same lower-sheet spot; only one is visible at a
          time because each is tied to its own scroll-hold range. */}
      <SheetCTA progress={p} holdStart={STOPS[1]} holdEnd={STOPS[2]} />
      <SheetCTA progress={p} holdStart={STOPS[3]} holdEnd={STOPS[4]} />
    </section>
  );
}
