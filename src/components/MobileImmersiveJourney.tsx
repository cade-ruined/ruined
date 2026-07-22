"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import Image from "next/image";
import Link from "next/link";
import MobileWalkTransition, {
  type MobileWalkTransitionHandle,
} from "@/components/sequence/MobileWalkTransition";
import {
  MOBILE_ARRIVAL_FRAME_PATHS,
  MOBILE_SCENE_IDS,
  mobileSceneIndexFromHash,
  type MobileSceneId,
} from "@/data/mobileJourney";
import { versionSequenceAsset } from "@/data/sequences";

type MobileScene = {
  id: Exclude<MobileSceneId, "events">;
  href: "#store" | `/${"store" | "work" | "about"}`;
  image: string;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
};

const MOBILE_SCENES = [
  {
    id: "top",
    href: "#store",
    image: versionSequenceAsset(MOBILE_ARRIVAL_FRAME_PATHS[0]),
    eyebrow: "The Ruined Project",
    title: "Enter Ruined",
    description: "Objects, garments, spaces, and projects after the fear.",
    cta: "Begin the walk",
  },
  {
    id: "store",
    href: "/store",
    image: versionSequenceAsset(MOBILE_ARRIVAL_FRAME_PATHS[1]),
    eyebrow: "01 / Artifacts",
    title: "The Store",
    description: "Objects and garments made to gather a history.",
    cta: "Enter the store",
  },
  {
    id: "work",
    href: "/work",
    image: versionSequenceAsset(MOBILE_ARRIVAL_FRAME_PATHS[2]),
    eyebrow: "02 / Project Hub",
    title: "The Work",
    description: "Objects, spaces, and material records from the studio.",
    cta: "Open the project hub",
  },
  {
    id: "about",
    href: "/about",
    image: versionSequenceAsset(MOBILE_ARRIVAL_FRAME_PATHS[3]),
    eyebrow: "03 / Studio No. 17",
    title: "What Remains",
    description: "A practice shaped by use, wear, place, and what survives.",
    cta: "About the studio",
  },
] as const satisfies readonly MobileScene[];

const MOBILE_STAGE_QUERY = "(max-width: 767px), (any-pointer: coarse)";
const SWIPE_DISTANCE_PX = 52;
const MOBILE_FIRESIDE_SRC = versionSequenceAsset(
  "/sequences/fireside/fire-stream-loop-mobile.mp4"
);
const MOBILE_FIRESIDE_POSTER = versionSequenceAsset(
  MOBILE_ARRIVAL_FRAME_PATHS[4]
);
const MOBILE_SCENE_LABELS = [
  "Home",
  "Store",
  "Work",
  "About",
  "Events",
] as const;

type GestureStart = {
  pointerId: number;
  x: number;
  y: number;
};

function MobileRoomScene({
  scene,
  priority,
  active,
  index,
  enhanced,
  onSceneRequest,
}: {
  scene: MobileScene;
  priority: boolean;
  active: boolean;
  index: number;
  enhanced: boolean;
  onSceneRequest: (
    event: ReactMouseEvent<HTMLAnchorElement>,
    index: number
  ) => void;
}) {
  const headingId = `mobile-${scene.id}-heading`;

  return (
    <article
      id={scene.id}
      data-scene-id={scene.id}
      aria-labelledby={headingId}
      aria-describedby={`${headingId}-position`}
      aria-roledescription="slide"
      aria-hidden={enhanced && !active ? true : undefined}
      hidden={enhanced && !active}
      className="ruined-mobile-scene"
    >
      <span id={`${headingId}-position`} className="sr-only">
        Slide {index + 1} of {MOBILE_SCENE_IDS.length}
      </span>
      <div className="ruined-mobile-scene__visual">
        <div className="ruined-mobile-scene__media">
          <Image
            src={scene.image}
            alt=""
            fill
            sizes="100vw"
            priority={priority}
            unoptimized
            draggable={false}
            className="ruined-mobile-scene__image"
          />
        </div>
        <div className="ruined-mobile-scene__scrim" aria-hidden="true" />
        <div className="ruined-mobile-scene__copy">
          <p className="ruined-mobile-scene__eyebrow">{scene.eyebrow}</p>
          <h2 id={headingId} className="ruined-mobile-scene__title">
            {scene.title}
          </h2>
          <p className="ruined-mobile-scene__description">
            {scene.description}
          </p>
          <Link
            className="ruined-mobile-scene__link"
            href={scene.href}
            onClick={
              scene.href.startsWith("#")
                ? (event) => onSceneRequest(event, 1)
                : undefined
            }
          >
            <span>{scene.cta}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

function MobileFiresideVideo({
  prepare,
  play,
}: {
  prepare: boolean;
  play: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [visible, setVisible] = useState(false);
  const shouldLoad = prepare && !reduceMotion;
  const shouldPlay = play && shouldLoad;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReduceMotion(media.matches);
    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setVisible(false);
    if (!shouldPlay) {
      video.pause();
      if (video.readyState > HTMLMediaElement.HAVE_NOTHING) {
        video.currentTime = 0;
      }
      return;
    }

    const startPlayback = () => {
      video.currentTime = 0;
      void video.play().catch(() => setVisible(false));
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      startPlayback();
      return;
    }

    video.addEventListener("loadeddata", startPlayback, { once: true });
    return () => video.removeEventListener("loadeddata", startPlayback);
  }, [shouldPlay]);

  return (
    <video
      ref={videoRef}
      src={shouldLoad ? MOBILE_FIRESIDE_SRC : undefined}
      poster={MOBILE_FIRESIDE_POSTER}
      muted
      loop
      playsInline
      preload={shouldLoad ? "auto" : "none"}
      aria-hidden="true"
      onPlaying={() => setVisible(true)}
      className={`ruined-mobile-closing__video${
        visible && shouldPlay ? " is-visible" : ""
      }`}
    />
  );
}

export default function MobileImmersiveJourney() {
  const journeyRef = useRef<HTMLElement>(null);
  const walkRef = useRef<MobileWalkTransitionHandle>(null);
  const activeIndexRef = useRef(0);
  const stageEnabledRef = useRef(false);
  const mountedRef = useRef(true);
  const transitioningRef = useRef(false);
  const pendingIndexRef = useRef<number | null>(null);
  const wheelCooldownUntilRef = useRef(0);
  const gestureRef = useRef<GestureStart | null>(null);
  const navigateRef = useRef<(index: number) => void>(() => undefined);
  const [activeIndex, setActiveIndex] = useState(0);
  const [settledIndex, setSettledIndex] = useState(0);
  const [stageEnabled, setStageEnabled] = useState(false);
  const [announcement, setAnnouncement] = useState("Home");

  const setScene = useCallback((index: number) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
  }, []);

  const commitScene = useCallback((index: number) => {
    const id = MOBILE_SCENE_IDS[index];
    const hash = `#${id}`;
    if (window.location.hash !== hash) {
      const url = new URL(window.location.href);
      url.hash = hash;
      window.history.replaceState(window.history.state, "", url);
    }
    setSettledIndex(index);
    setAnnouncement(`Now viewing ${MOBILE_SCENE_LABELS[index]}`);
    window.dispatchEvent(
      new CustomEvent("ruined:home-scene-change", {
        detail: { id, hash, index },
      })
    );
  }, []);

  const navigateTo = useCallback(
    async (requestedIndex: number) => {
      const targetIndex = Math.max(
        0,
        Math.min(MOBILE_SCENE_IDS.length - 1, requestedIndex)
      );

      if (transitioningRef.current) {
        pendingIndexRef.current = targetIndex;
        return;
      }

      const fromIndex = activeIndexRef.current;
      if (targetIndex === fromIndex) {
        commitScene(targetIndex);
        return;
      }

      transitioningRef.current = true;
      const transition = walkRef.current;
      if (transition) {
        await transition.play(fromIndex, targetIndex, () => {
          setScene(targetIndex);
        });
      } else {
        setScene(targetIndex);
      }
      if (!mountedRef.current || !stageEnabledRef.current) {
        transitioningRef.current = false;
        pendingIndexRef.current = null;
        return;
      }
      commitScene(targetIndex);
      transitioningRef.current = false;
      wheelCooldownUntilRef.current = window.performance.now() + 400;

      const pendingIndex = pendingIndexRef.current;
      pendingIndexRef.current = null;
      if (pendingIndex !== null && pendingIndex !== targetIndex) {
        window.setTimeout(() => navigateRef.current(pendingIndex), 0);
      }
    },
    [commitScene, setScene]
  );

  navigateRef.current = (index) => {
    void navigateTo(index);
  };

  useLayoutEffect(() => {
    const initialIndex = mobileSceneIndexFromHash(window.location.hash);
    setScene(initialIndex);
    setSettledIndex(initialIndex);
    walkRef.current?.prepare(initialIndex);
  }, [setScene]);

  useLayoutEffect(() => {
    const media = window.matchMedia(MOBILE_STAGE_QUERY);
    const syncStage = () => {
      const enabled = media.matches;
      stageEnabledRef.current = enabled;
      setStageEnabled(enabled);
      document.documentElement.classList.toggle(
        "ruined-mobile-stage-active",
        enabled
      );
      document.body.classList.toggle("ruined-mobile-stage-active", enabled);
      if (enabled) window.scrollTo({ top: 0, behavior: "auto" });
    };
    syncStage();
    media.addEventListener("change", syncStage);
    return () => {
      stageEnabledRef.current = false;
      media.removeEventListener("change", syncStage);
      document.documentElement.classList.remove("ruined-mobile-stage-active");
      document.body.classList.remove("ruined-mobile-stage-active");
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (stageEnabled) walkRef.current?.prepare(activeIndex);
  }, [activeIndex, stageEnabled]);

  useEffect(() => {
    if (!stageEnabled) return;
    const syncFromLocation = () => {
      navigateRef.current(mobileSceneIndexFromHash(window.location.hash));
    };
    const requestScene = (event: Event) => {
      const request = event as CustomEvent<{ hash?: string; index?: number }>;
      const requestedIndex =
        typeof request.detail?.index === "number"
          ? request.detail.index
          : mobileSceneIndexFromHash(request.detail?.hash ?? "");
      event.preventDefault();
      navigateRef.current(requestedIndex);
    };

    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("ruined:home-scene-request", requestScene);
    commitScene(activeIndexRef.current);
    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("ruined:home-scene-request", requestScene);
    };
  }, [commitScene, stageEnabled]);

  const requestOffset = useCallback((offset: -1 | 1) => {
    if (!stageEnabledRef.current) return;
    const nextIndex = activeIndexRef.current + offset;
    if (nextIndex < 0 || nextIndex >= MOBILE_SCENE_IDS.length) return;
    navigateRef.current(nextIndex);
  }, []);

  const handleSceneLink = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>, index: number) => {
      if (
        !stageEnabledRef.current ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      navigateRef.current(index);
    },
    []
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const target = event.target as Element;
      const internalScroller = target.closest<HTMLElement>(
        "[data-mobile-internal-scroll]"
      );
      if (
        !stageEnabledRef.current ||
        transitioningRef.current ||
        !event.isPrimary ||
        (event.pointerType === "mouse" && event.button !== 0) ||
        target.closest(
          "a, button, input, select, textarea, [role='button']"
        ) ||
        (internalScroller &&
          internalScroller.scrollHeight > internalScroller.clientHeight)
      ) {
        return;
      }
      gestureRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    []
  );

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = gestureRef.current;
      gestureRef.current = null;
      if (!start || start.pointerId !== event.pointerId) return;
      const verticalDistance = start.y - event.clientY;
      const horizontalDistance = Math.abs(start.x - event.clientX);
      if (
        Math.abs(verticalDistance) < SWIPE_DISTANCE_PX ||
        Math.abs(verticalDistance) <= horizontalDistance * 1.2
      ) {
        return;
      }
      requestOffset(verticalDistance > 0 ? 1 : -1);
    },
    [requestOffset]
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (
        !stageEnabledRef.current ||
        Math.abs(event.deltaY) < 32 ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      ) {
        return;
      }
      const internalScroller = (event.target as Element).closest<HTMLElement>(
        "[data-mobile-internal-scroll]"
      );
      if (
        internalScroller &&
        internalScroller.scrollHeight > internalScroller.clientHeight
      ) {
        return;
      }
      event.preventDefault();
      if (
        transitioningRef.current ||
        window.performance.now() < wheelCooldownUntilRef.current
      ) {
        return;
      }
      requestOffset(event.deltaY > 0 ? 1 : -1);
    },
    [requestOffset]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (["ArrowDown", "PageDown"].includes(event.key)) {
        event.preventDefault();
        requestOffset(1);
      } else if (["ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        requestOffset(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        navigateRef.current(0);
      } else if (event.key === "End") {
        event.preventDefault();
        navigateRef.current(MOBILE_SCENE_IDS.length - 1);
      }
    },
    [requestOffset]
  );

  const activeSceneId = MOBILE_SCENE_IDS[activeIndex];

  return (
    <section
      ref={journeyRef}
      data-journey="mobile"
      data-mobile-stage={stageEnabled ? "" : undefined}
      data-stage-enabled={stageEnabled ? "" : undefined}
      data-active-scene={activeSceneId}
      aria-labelledby="mobile-journey-heading"
      aria-roledescription="carousel"
      className="ruined-mobile-journey"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={() => {
        gestureRef.current = null;
      }}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      <h1 id="mobile-journey-heading" className="sr-only">
        Ruined — objects, garments, spaces, and projects after the fear
      </h1>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {stageEnabled && (
        <MobileWalkTransition ref={walkRef} journeyRef={journeyRef} />
      )}

      {MOBILE_SCENES.map((scene, index) => (
        <MobileRoomScene
          key={scene.id}
          scene={scene}
          priority={index === 0}
          active={activeIndex === index}
          index={index}
          enhanced={stageEnabled}
          onSceneRequest={handleSceneLink}
        />
      ))}

      <section
        id="events"
        data-scene-id="events"
        aria-labelledby="mobile-fear-heading"
        aria-describedby="mobile-events-position"
        aria-roledescription="slide"
        aria-hidden={stageEnabled && activeIndex !== 4 ? true : undefined}
        hidden={stageEnabled && activeIndex !== 4}
        className="ruined-mobile-closing"
      >
        <span id="mobile-events-position" className="sr-only">
          Slide 5 of {MOBILE_SCENE_IDS.length}
        </span>
        <div className="ruined-mobile-closing__media" aria-hidden="true">
          <Image
            src={MOBILE_FIRESIDE_POSTER}
            alt=""
            fill
            sizes="100vw"
            unoptimized
            draggable={false}
            className="ruined-mobile-scene__image"
          />
          <MobileFiresideVideo
            prepare={stageEnabled && activeIndex === 4}
            play={
              stageEnabled && activeIndex === 4 && settledIndex === activeIndex
            }
          />
        </div>
        <div
          className="ruined-mobile-closing__inner"
          data-mobile-internal-scroll
        >
          <p className="ruined-mobile-closing__registration">RU // AW26</p>
          <h2 id="mobile-fear-heading" className="ruined-mobile-closing__title">
            <span>After</span>
            <span>The</span>
            <span className="ruined-mobile-closing__fear">Fear</span>
          </h2>

          <div className="ruined-mobile-closing__footer">
            <div className="ruined-mobile-closing__rule" aria-hidden="true">
              <span>⊕</span>
              <span />
              <span>⊕</span>
            </div>
            <div className="ruined-mobile-closing__credit">
              <span>© 2026 The Ruined Project</span>
              <span>40.4633° N / 111.7780° W</span>
            </div>
            <Link className="ruined-mobile-closing__events-link" href="/events">
              <span>View the studio programme</span>
              <span aria-hidden="true">→</span>
            </Link>
            <nav
              aria-label="Explore after the journey"
              className="ruined-mobile-closing__nav"
            >
              <Link href="/store">Store</Link>
              <Link href="/work">Work</Link>
              <Link href="/events">Events</Link>
              <Link href="/about">About</Link>
              <a href="#top" onClick={(event) => handleSceneLink(event, 0)}>
                Walk again ↺
              </a>
            </nav>
          </div>
        </div>
      </section>

      <style>{`
        html.ruined-mobile-stage-active,
        html.ruined-mobile-stage-active body {
          width: 100%;
          height: 100%;
          overflow: hidden !important;
          overscroll-behavior: none;
        }

        html.ruined-mobile-stage-active body > footer {
          display: none;
        }

        .ruined-mobile-journey {
          position: relative;
          display: block;
          overflow: clip;
          isolation: isolate;
          background: #080605;
          color: var(--color-bone, #e5e0d5);
          touch-action: pan-y;
        }

        .ruined-mobile-journey[data-stage-enabled] {
          width: 100%;
          height: 100vh;
          min-height: 100vh;
          overflow: hidden;
          touch-action: pan-x pinch-zoom;
          overscroll-behavior: none;
        }

        .ruined-mobile-journey[data-stage-enabled]:focus-visible {
          outline: 2px solid var(--color-signal, #e5a923);
          outline-offset: -2px;
        }

        .ruined-mobile-walk {
          position: absolute;
          inset: 0;
          z-index: 3;
          width: 100%;
          height: 100vh;
          background: #080605;
          opacity: 0;
          pointer-events: none;
          contain: strict;
        }

        .ruined-mobile-scene__media,
        .ruined-mobile-closing__media {
          position: absolute;
          inset: 0;
          z-index: -2;
          background-color: #080605;
          overflow: hidden;
        }

        .ruined-mobile-scene__image {
          object-fit: cover;
          object-position: center;
          user-select: none;
        }

        .ruined-mobile-closing__video {
          position: absolute;
          inset: 0;
          z-index: 1;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          opacity: 0;
          transition: opacity 200ms ease-out;
          pointer-events: none;
        }

        .ruined-mobile-closing__video.is-visible {
          opacity: 1;
        }

        .ruined-mobile-journey[data-walking] .ruined-mobile-scene__media,
        .ruined-mobile-journey[data-walking] .ruined-mobile-closing__media,
        .ruined-mobile-journey[data-walking] .ruined-mobile-scene__scrim {
          opacity: 0;
        }

        .ruined-mobile-journey[data-walking] .ruined-mobile-closing {
          background: transparent;
        }

        .ruined-mobile-journey[data-walking] .ruined-mobile-scene__copy,
        .ruined-mobile-journey[data-walking] .ruined-mobile-closing__inner {
          opacity: 0;
          pointer-events: none;
        }

        .ruined-mobile-scene,
        .ruined-mobile-closing {
          position: relative;
          z-index: 1;
          width: 100%;
          height: 100vh;
          min-height: 100vh;
          margin: 0;
        }

        .ruined-mobile-journey[data-stage-enabled] .ruined-mobile-scene,
        .ruined-mobile-journey[data-stage-enabled] .ruined-mobile-closing {
          position: absolute;
          inset: 0;
        }

        .ruined-mobile-scene[hidden],
        .ruined-mobile-closing[hidden] {
          display: none !important;
        }

        .ruined-mobile-scene__visual {
          position: relative;
          height: 100%;
          overflow: hidden;
          isolation: isolate;
        }

        .ruined-mobile-scene__scrim {
          position: absolute;
          inset: 0;
          z-index: -1;
          background:
            linear-gradient(to bottom, rgba(8, 6, 5, 0.24) 0%, transparent 34%),
            linear-gradient(to top, rgba(8, 6, 5, 0.96) 0%, rgba(8, 6, 5, 0.54) 34%, transparent 68%);
          pointer-events: none;
        }

        .ruined-mobile-scene__copy {
          position: absolute;
          inset-inline: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding:
            1.25rem
            max(1.25rem, env(safe-area-inset-right, 0px))
            calc(env(safe-area-inset-bottom, 0px) + 5.75rem)
            max(1.25rem, env(safe-area-inset-left, 0px));
        }

        .ruined-mobile-scene__eyebrow,
        .ruined-mobile-closing__registration {
          margin: 0 0 0.65rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.56rem;
          line-height: 1;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 68%, transparent);
        }

        .ruined-mobile-scene__title {
          max-width: 8ch;
          margin: 0;
          font-family: var(--font-header, Inter, sans-serif) !important;
          font-size: clamp(2.5rem, 12vw, 4.5rem);
          font-weight: var(--weight-header, 700) !important;
          line-height: 0.86;
          letter-spacing: -0.055em;
          text-transform: uppercase;
          text-wrap: balance;
          color: var(--color-bone, #e5e0d5);
          text-shadow: 0 2px 20px rgba(0, 0, 0, 0.35);
        }

        .ruined-mobile-scene__description {
          max-width: 28rem;
          margin: 0.9rem 0 1rem;
          font-size: 0.82rem;
          line-height: 1.5;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 76%, transparent);
        }

        .ruined-mobile-scene__link,
        .ruined-mobile-closing__events-link {
          display: inline-flex;
          min-height: 2.75rem;
          align-items: center;
          justify-content: space-between;
          gap: 1.5rem;
          border: 1.5px solid var(--color-bone, #e5e0d5);
          padding: 0.75rem 0.9rem;
          background: color-mix(in srgb, #080605 78%, transparent);
          color: var(--color-bone, #e5e0d5);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.56rem;
          line-height: 1;
          letter-spacing: 0.16em;
          text-decoration: none;
          text-transform: uppercase;
          box-shadow: 4px 4px 0 var(--color-poster, #d0312d);
          -webkit-tap-highlight-color: transparent;
        }

        .ruined-mobile-scene__link:active {
          transform: translate3d(2px, 2px, 0);
          box-shadow: 2px 2px 0 var(--color-poster, #d0312d);
        }

        .ruined-mobile-closing {
          background: linear-gradient(to bottom, rgba(8, 6, 5, 0.72), #080605 58%);
        }

        .ruined-mobile-closing__inner {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding:
            max(5rem, env(safe-area-inset-top, 0px))
            max(1.25rem, env(safe-area-inset-right, 0px))
            calc(env(safe-area-inset-bottom, 0px) + 5.75rem)
            max(1.25rem, env(safe-area-inset-left, 0px));
        }

        .ruined-mobile-closing__registration {
          margin-bottom: 1.25rem;
          color: var(--color-signal, #e5a923);
        }

        .ruined-mobile-closing__title {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 0;
          font-family: var(--font-header, Inter, sans-serif) !important;
          font-size: clamp(3.5rem, 18vw, 6rem);
          font-weight: var(--weight-header, 700) !important;
          line-height: 0.79;
          letter-spacing: -0.06em;
          text-transform: uppercase;
          color: var(--color-bone, #e5e0d5);
        }

        .ruined-mobile-closing__fear {
          font-family: var(--font-display, Georgia, serif) !important;
          font-style: italic;
          color: var(--color-signal, #e5a923);
        }

        .ruined-mobile-closing__footer {
          width: 100%;
          margin-top: auto;
          padding-top: 3rem;
        }

        .ruined-mobile-closing__rule {
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 0.75rem;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 42%, transparent);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.6rem;
        }

        .ruined-mobile-closing__rule > span:nth-child(2) {
          height: 1px;
          background: color-mix(in srgb, var(--color-bone, #e5e0d5) 20%, transparent);
        }

        .ruined-mobile-closing__credit {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          margin-top: 0.75rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.46rem;
          line-height: 1.5;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 48%, transparent);
        }

        .ruined-mobile-closing__credit > span:last-child {
          text-align: right;
        }

        .ruined-mobile-closing__events-link {
          display: flex;
          margin-top: 1.25rem;
          background: rgba(229, 224, 213, 0.04);
        }

        .ruined-mobile-closing__nav {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 0.9rem 1.25rem;
          margin-top: 1.25rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.54rem;
          line-height: 1.4;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .ruined-mobile-closing__nav a {
          min-height: 2.75rem;
          display: inline-flex;
          align-items: center;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 74%, transparent);
          text-decoration: none;
        }

        .ruined-mobile-closing__nav a:last-child {
          color: var(--color-signal, #e5a923);
        }

        @supports (height: 100svh) {
          .ruined-mobile-journey[data-stage-enabled],
          .ruined-mobile-walk,
          .ruined-mobile-scene,
          .ruined-mobile-closing {
            height: 100svh;
            min-height: 100svh;
          }
        }

        @supports (height: 100dvh) {
          .ruined-mobile-journey[data-stage-enabled],
          .ruined-mobile-walk,
          .ruined-mobile-scene,
          .ruined-mobile-closing {
            height: 100dvh;
            min-height: 100dvh;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ruined-mobile-walk {
            display: none;
          }

          .ruined-mobile-closing__video {
            display: none;
          }
        }

        @media (max-height: 650px) {
          .ruined-mobile-journey[data-stage-enabled][data-active-scene="events"],
          .ruined-mobile-closing__inner {
            touch-action: pan-y pinch-zoom;
          }

          .ruined-mobile-closing__inner {
            justify-content: flex-start;
            overflow-y: auto;
            overscroll-behavior: contain;
          }
        }
      `}</style>
    </section>
  );
}
