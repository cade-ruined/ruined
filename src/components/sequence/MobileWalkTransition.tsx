"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type RefObject,
} from "react";
import {
  MOBILE_TRANSITION_SAMPLE_COUNT,
  MOBILE_WALK_TRANSITIONS,
} from "@/data/mobileJourney";
import {
  mobileSequenceFramePath,
  versionSequenceAsset,
} from "@/data/sequences";
import {
  sequenceAssetFocalX,
  sequenceCoverRect,
} from "@/utils/sequenceFraming";

// Keep the same small mobile request budget for every room, even when the
// source renders have different lengths. Endpoints are always included so the
// transition and the next scene share an identical handoff frame.
const TRANSITION_DURATION_MS = 520;
const ARRIVAL_HOLD_MS = 70;
const FRAME_WAIT_TIMEOUT_MS = 4000;
const TRANSITION_GATE_TIMEOUT_MS = 1500;
const LOADING_INDICATOR_DELAY_MS = 120;
const FRAME_RETRY_BASE_MS = 500;
const FRAME_RETRY_MAX_MS = 8000;
// A restrained directional trail keeps the walk feeling physical without
// obscuring the room imagery. It peaks at the middle of the transition, then
// resolves to the exact canonical arrival frame for a seamless handoff.
const MOTION_SMEAR_TAPS = 4;
const MOTION_SMEAR_DISTANCE_RATIO = 0.18;
const MOTION_SMEAR_TAP_ALPHA = 0.11;
const FILM_BURN_MAX_ALPHA = 0.32;
// Keep one complete transition resident even in browsers that cannot resize
// during createImageBitmap, while still bounding decoded memory near 80 MB.
const MAX_DECODED_PIXELS = 20_000_000;
function sampleFrameNumbers(frameCount: number) {
  return Array.from({ length: MOBILE_TRANSITION_SAMPLE_COUNT }, (_, index) =>
    Math.ceil(
      (index * (frameCount - 1)) / (MOBILE_TRANSITION_SAMPLE_COUNT - 1)
    ) + 1
  );
}

let transitionFrameOffset = 0;
const TRANSITION_SEGMENTS = MOBILE_WALK_TRANSITIONS.map(
  ({ room, frameCount, startFrame, endFrame }) => {
    const frameNumbers = sampleFrameNumbers(frameCount);
    const frames = frameNumbers.map((frame, index) => {
      if (index === 0 || index === frameNumbers.length - 1) {
        return {
          src: versionSequenceAsset(index === 0 ? startFrame : endFrame),
        };
      }

      return {
        src: versionSequenceAsset(mobileSequenceFramePath(room, frame)),
        fallbackSrc: versionSequenceAsset(
          `/sequences/${room}/frame-${String(frame).padStart(4, "0")}.webp`
        ),
      };
    });
    const start = transitionFrameOffset;
    transitionFrameOffset += frames.length;
    return {
      start,
      end: transitionFrameOffset - 1,
      length: frames.length,
      frames,
    };
  }
);
const TRANSITION_FRAMES = TRANSITION_SEGMENTS.flatMap(
  (segment) => segment.frames
);
const MAX_TRANSITION_FRAMES = Math.max(
  ...TRANSITION_SEGMENTS.map((segment) => segment.length)
);

type DecodedFrame = ImageBitmap | HTMLImageElement;

export type MobileWalkTransitionHandle = {
  prepare: (sceneIndex: number) => void;
  play: (
    fromIndex: number,
    toIndex: number,
    onStart: () => void
  ) => Promise<boolean>;
};

function releaseFrame(frame: DecodedFrame) {
  if ("close" in frame) frame.close();
}

async function decodeFrame(blob: Blob): Promise<DecodedFrame> {
  if ("createImageBitmap" in window) {
    try {
      // Intermediate frames are already portrait-sized, while canonical room
      // endpoints retain their native landscape aspect ratio. Resizing both to
      // one fixed box here stretches the endpoints during the handoff.
      return await createImageBitmap(blob);
    } catch {
      return createImageBitmap(blob);
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MobileWalkTransition = forwardRef<
  MobileWalkTransitionHandle,
  { journeyRef: RefObject<HTMLElement | null> }
>(function MobileWalkTransition({ journeyRef }, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadingRef = useRef<HTMLSpanElement>(null);
  const prepareRef = useRef<(sceneIndex: number) => void>(() => undefined);
  const playRef = useRef<MobileWalkTransitionHandle["play"]>(
    async (_fromIndex, _toIndex, onStart) => {
      onStart();
      return false;
    }
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      prepare: (sceneIndex) => prepareRef.current(sceneIndex),
      play: (fromIndex, toIndex, onStart) =>
        playRef.current(fromIndex, toIndex, onStart),
    }),
    []
  );

  useEffect(() => {
    const journey = journeyRef.current;
    const canvas = canvasRef.current;
    if (!journey || !canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );
    const cache = new Map<number, DecodedFrame>();
    const inflight = new Map<number, AbortController>();
    const queued = new Set<number>();
    const failures = new Map<number, { count: number; retryAt: number }>();
    const waiters = new Map<number, Set<(ready: boolean) => void>>();
    const CAP = MAX_TRANSITION_FRAMES * 2;
    const MAX_INFLIGHT = 3;

    let queue: number[] = [];
    let target = 0;
    let activeSegment = -1;
    let lastDrawn = -1;
    let playRaf = 0;
    let holdTimer = 0;
    let playToken = 0;
    let activeResolve: ((animated: boolean) => void) | null = null;
    let pendingOnStart: (() => void) | null = null;
    let preparedSceneIndex = 0;
    let loadingIndicatorTimer = 0;
    let motionSmearStrength = 0;
    let motionSmearDirection = 1;
    let disposed = false;

    const setLoading = (loading: boolean) => {
      window.clearTimeout(loadingIndicatorTimer);
      loadingIndicatorTimer = 0;
      journey.toggleAttribute("data-walk-loading", loading);
      const indicator = loadingRef.current;
      if (!indicator) return;
      if (!loading) {
        indicator.hidden = true;
        return;
      }
      loadingIndicatorTimer = window.setTimeout(() => {
        loadingIndicatorTimer = 0;
        if (!disposed && journey.hasAttribute("data-walk-loading")) {
          indicator.hidden = false;
        }
      }, LOADING_INDICATOR_DELAY_MS);
    };

    const draw = (
      frame: DecodedFrame,
      index: number,
      smearStrength = motionSmearStrength,
      smearDirection = motionSmearDirection
    ) => {
      const rect = sequenceCoverRect(
        frame.width,
        frame.height,
        canvas.width,
        canvas.height,
        sequenceAssetFocalX(TRANSITION_FRAMES[index].src)
      );
      context.fillStyle = "#080605";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.globalAlpha = 1;
      context.drawImage(
        frame,
        rect.x,
        rect.y,
        rect.width,
        rect.height
      );

      if (smearStrength > 0.02) {
        const distance =
          canvas.width *
          MOTION_SMEAR_DISTANCE_RATIO *
          smearStrength *
          smearDirection;
        context.globalAlpha = MOTION_SMEAR_TAP_ALPHA * smearStrength;
        for (let tap = MOTION_SMEAR_TAPS; tap >= 1; tap -= 1) {
          const offset = distance * (tap / MOTION_SMEAR_TAPS);
          context.drawImage(
            frame,
            rect.x - offset,
            rect.y,
            rect.width,
            rect.height
          );
        }

        // A brief warm edge flare makes the travel read as a deliberate film
        // splice instead of an image waiting to resolve. It follows the walk
        // direction, peaks between rooms, and disappears on the arrival frame.
        context.globalCompositeOperation = "screen";
        context.globalAlpha = FILM_BURN_MAX_ALPHA * smearStrength;
        const burnEdge = smearDirection > 0 ? canvas.width : 0;
        const burn = context.createRadialGradient(
          burnEdge,
          canvas.height * 0.48,
          0,
          burnEdge,
          canvas.height * 0.48,
          canvas.width * 0.78
        );
        burn.addColorStop(0, "rgba(255, 224, 128, 0.96)");
        burn.addColorStop(0.18, "rgba(255, 104, 30, 0.78)");
        burn.addColorStop(0.48, "rgba(190, 20, 28, 0.34)");
        burn.addColorStop(1, "rgba(22, 5, 18, 0)");
        context.fillStyle = burn;
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.globalAlpha = 0.14 * smearStrength;
        context.fillStyle = smearDirection > 0 ? "#00a9a1" : "#bb204f";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.restore();
      lastDrawn = index;
      canvas.style.opacity = "1";
      journey.toggleAttribute("data-walking", true);
      journey.toggleAttribute("data-motion-smear", smearStrength > 0.02);
    };

    const renderTarget = () => {
      if (activeSegment < 0) return;
      const frame = cache.get(target);
      if (frame && target !== lastDrawn) draw(frame, target);
    };

    const evict = () => {
      let decodedPixels = [...cache.values()].reduce(
        (total, frame) => total + frame.width * frame.height,
        0
      );
      if (cache.size <= CAP && decodedPixels <= MAX_DECODED_PIXELS) return;
      const activeBounds = TRANSITION_SEGMENTS[activeSegment];
      const candidates = [...cache.keys()]
        .filter(
          (index) =>
            activeSegment < 0 ||
            !activeBounds ||
            index < activeBounds.start ||
            index > activeBounds.end
        )
        .sort((a, b) => Math.abs(b - target) - Math.abs(a - target));
      while (cache.size > CAP || decodedPixels > MAX_DECODED_PIXELS) {
        const index = candidates.shift();
        if (index === undefined) break;
        const frame = cache.get(index);
        if (frame) {
          decodedPixels -= frame.width * frame.height;
          releaseFrame(frame);
        }
        cache.delete(index);
      }
    };

    const resolveWaiters = (index: number, ready: boolean) => {
      const pending = waiters.get(index);
      if (!pending) return;
      waiters.delete(index);
      pending.forEach((resolve) => resolve(ready));
    };

    const resolveAllWaiters = (ready: boolean) => {
      waiters.forEach((pending) =>
        pending.forEach((resolve) => resolve(ready))
      );
      waiters.clear();
    };

    const loadFrame = async (index: number, signal: AbortSignal) => {
      const source = TRANSITION_FRAMES[index];
      const candidates = [
        source.src,
        "fallbackSrc" in source ? source.fallbackSrc : undefined,
      ].filter((candidate): candidate is string => Boolean(candidate));
      let lastError: unknown;

      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate, {
            cache: "force-cache",
            signal,
          });
          if (!response.ok) {
            throw new Error(`Frame returned ${response.status}`);
          }
          return await decodeFrame(await response.blob());
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          lastError = error;
        }
      }

      throw lastError ?? new Error("Frame could not be loaded");
    };

    const decode = async (index: number, controller: AbortController) => {
      let ready = false;
      try {
        const frame = await loadFrame(index, controller.signal);
        if (disposed || controller.signal.aborted) {
          releaseFrame(frame);
          return;
        }
        cache.set(index, frame);
        failures.delete(index);
        ready = true;
        evict();
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          const count = Math.min((failures.get(index)?.count ?? 0) + 1, 8);
          failures.set(index, {
            count,
            retryAt:
              Date.now() +
              Math.min(
                FRAME_RETRY_BASE_MS * 2 ** (count - 1),
                FRAME_RETRY_MAX_MS
              ),
          });
        }
      } finally {
        if (inflight.get(index) === controller) inflight.delete(index);
        resolveWaiters(index, ready);
        pump();
      }
    };

    function pump() {
      if (disposed || reducedMotion.matches) return;
      while (inflight.size < MAX_INFLIGHT && queue.length) {
        const index = queue.shift();
        if (index === undefined) break;
        queued.delete(index);
        if (
          cache.has(index) ||
          inflight.has(index)
        ) {
          continue;
        }
        const failed = failures.get(index);
        if (failed && Date.now() < failed.retryAt) continue;
        const controller = new AbortController();
        inflight.set(index, controller);
        void decode(index, controller);
      }
    }

    const schedule = (index: number, urgent = false) => {
      const failed = failures.get(index);
      if (
        reducedMotion.matches ||
        index < 0 ||
        index >= TRANSITION_FRAMES.length ||
        cache.has(index) ||
        inflight.has(index) ||
        (failed && Date.now() < failed.retryAt)
      ) {
        return;
      }
      if (queued.has(index)) {
        if (urgent) {
          queue = queue.filter((candidate) => candidate !== index);
          queue.unshift(index);
        }
      } else {
        queued.add(index);
        if (urgent) queue.unshift(index);
        else queue.push(index);
      }
      pump();
    };

    const ensure = (index: number) => {
      if (cache.has(index)) return Promise.resolve(true);
      const failed = failures.get(index);
      if (
        disposed ||
        reducedMotion.matches ||
        (failed && Date.now() < failed.retryAt)
      ) {
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const pending = waiters.get(index) ?? new Set();
        let timer = 0;
        const settle = (ready: boolean) => {
          window.clearTimeout(timer);
          pending.delete(settle);
          if (pending.size === 0) waiters.delete(index);
          resolve(ready);
        };
        pending.add(settle);
        waiters.set(index, pending);
        timer = window.setTimeout(
          () => settle(false),
          FRAME_WAIT_TIMEOUT_MS
        );
        schedule(index, true);
      });
    };

    const waitForFrames = (indices: number[]) =>
      new Promise<boolean>((resolve) => {
        let settled = false;
        let remaining = indices.length;
        const finish = (ready: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(gateTimer);
          if (!ready) {
            indices.forEach((index) => resolveWaiters(index, false));
          }
          resolve(ready);
        };
        const gateTimer = window.setTimeout(
          () => finish(false),
          TRANSITION_GATE_TIMEOUT_MS
        );

        indices.forEach((index) => {
          void ensure(index).then((ready) => {
            if (settled) return;
            if (!ready) {
              finish(false);
              return;
            }
            remaining -= 1;
            if (remaining === 0) finish(true);
          });
        });
      });

    const warmTransition = (segment: number, reverse = false) => {
      const bounds = TRANSITION_SEGMENTS[segment];
      if (!bounds) return;
      const offsets = Array.from(
        { length: bounds.length },
        (_, index) => index
      );
      if (reverse) offsets.reverse();
      offsets.forEach((offset) => schedule(bounds.start + offset));
    };

    const prepare = (sceneIndex: number) => {
      preparedSceneIndex = sceneIndex;
      if (reducedMotion.matches) return;
      target =
        sceneIndex === 0
          ? TRANSITION_SEGMENTS[0].start
          : (TRANSITION_SEGMENTS[sceneIndex - 1]?.end ??
            TRANSITION_SEGMENTS.at(-1)?.end ??
            0);
      warmTransition(sceneIndex);
      warmTransition(sceneIndex - 1, true);
    };

    const hideCanvas = () => {
      activeSegment = -1;
      lastDrawn = -1;
      motionSmearStrength = 0;
      canvas.style.opacity = "0";
      journey.removeAttribute("data-walking");
      journey.removeAttribute("data-motion-smear");
      evict();
    };

    const finishWalk = (sceneIndex: number, token: number) => {
      if (token !== playToken) return;
      cancelAnimationFrame(playRaf);
      window.clearTimeout(holdTimer);
      playRaf = 0;
      holdTimer = 0;
      hideCanvas();
      prepare(sceneIndex);
      const resolve = activeResolve;
      activeResolve = null;
      resolve?.(true);
    };

    const handleReducedMotionChange = () => {
      if (!reducedMotion.matches) {
        prepare(preparedSceneIndex);
        return;
      }
      setLoading(false);
      pendingOnStart?.();
      pendingOnStart = null;
      queue = [];
      queued.clear();
      inflight.forEach((controller) => controller.abort());
      inflight.clear();
      resolveAllWaiters(false);
      playToken += 1;
      cancelAnimationFrame(playRaf);
      window.clearTimeout(holdTimer);
      playRaf = 0;
      holdTimer = 0;
      hideCanvas();
      const resolve = activeResolve;
      activeResolve = null;
      resolve?.(false);
    };

    prepareRef.current = prepare;
    playRef.current = async (fromIndex, toIndex, onStart) => {
      if (
        reducedMotion.matches ||
        Math.abs(fromIndex - toIndex) !== 1 ||
        disposed
      ) {
        onStart();
        prepare(toIndex);
        return false;
      }

      const token = ++playToken;
      pendingOnStart = onStart;
      cancelAnimationFrame(playRaf);
      window.clearTimeout(holdTimer);
      activeResolve?.(false);
      activeResolve = null;
      playRaf = 0;
      holdTimer = 0;

      const forward = toIndex > fromIndex;
      motionSmearDirection = forward ? 1 : -1;
      motionSmearStrength = 0;
      const segment = Math.min(fromIndex, toIndex);
      const segmentBounds = TRANSITION_SEGMENTS[segment];
      const frameStart = segmentBounds.start;
      const startIndex = forward ? segmentBounds.start : segmentBounds.end;
      const endIndex = forward ? segmentBounds.end : segmentBounds.start;

      activeSegment = segment;
      target = startIndex;
      lastDrawn = -1;
      warmTransition(segment, !forward);

      const frameIndices = Array.from(
        { length: segmentBounds.length },
        (_, index) => segmentBounds.start + index
      );
      if (!forward) frameIndices.reverse();
      setLoading(true);
      const ready = await waitForFrames(frameIndices);
      setLoading(false);
      if (disposed || token !== playToken) return false;
      if (
        !ready ||
        frameIndices.some((index) => !cache.has(index))
      ) {
        hideCanvas();
        pendingOnStart?.();
        pendingOnStart = null;
        prepare(toIndex);
        return false;
      }

      const startFrame = cache.get(startIndex);
      const endFrame = cache.get(endIndex);
      if (!startFrame || !endFrame) {
        hideCanvas();
        pendingOnStart?.();
        pendingOnStart = null;
        prepare(toIndex);
        return false;
      }

      draw(startFrame, startIndex, 0, motionSmearDirection);
      pendingOnStart?.();
      pendingOnStart = null;

      return new Promise<boolean>((resolve) => {
        activeResolve = resolve;
        let startedAt = 0;

        const tick = (now: number) => {
          if (token !== playToken || disposed) return;
          if (!startedAt) startedAt = now;
          const progress = Math.min(
            1,
            (now - startedAt) / TRANSITION_DURATION_MS
          );
          motionSmearStrength = Math.sin(progress * Math.PI) ** 0.65;
          const position = Math.round(
            progress * (segmentBounds.length - 1)
          );
          const offset = forward
            ? position
            : segmentBounds.length - 1 - position;
          target = frameStart + offset;
          renderTarget();

          if (progress < 1) {
            playRaf = requestAnimationFrame(tick);
            return;
          }

          const endpoint = cache.get(endIndex);
          motionSmearStrength = 0;
          if (endpoint) draw(endpoint, endIndex, 0, motionSmearDirection);
          holdTimer = window.setTimeout(
            () => finishWalk(toIndex, token),
            ARRIVAL_HOLD_MS
          );
        };

        playRaf = requestAnimationFrame(tick);
      });
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(bounds.width * dpr));
      canvas.height = Math.max(1, Math.round(bounds.height * dpr));
      lastDrawn = -1;
      renderTarget();
    };

    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    reducedMotion.addEventListener("change", handleReducedMotionChange);
    resize();

    return () => {
      disposed = true;
      playToken += 1;
      setLoading(false);
      window.clearTimeout(loadingIndicatorTimer);
      cancelAnimationFrame(playRaf);
      window.clearTimeout(holdTimer);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      reducedMotion.removeEventListener("change", handleReducedMotionChange);
      queue = [];
      queued.clear();
      inflight.forEach((controller) => controller.abort());
      inflight.clear();
      hideCanvas();
      pendingOnStart = null;
      activeResolve?.(false);
      activeResolve = null;
      resolveAllWaiters(false);
      cache.forEach(releaseFrame);
      cache.clear();
      failures.clear();
      prepareRef.current = () => undefined;
      playRef.current = async (_fromIndex, _toIndex, onStart) => {
        onStart();
        return false;
      };
    };
  }, [journeyRef]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="ruined-mobile-walk"
      />
      <span
        ref={loadingRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        hidden
        className="pointer-events-none absolute left-1/2 z-[4] -translate-x-1/2 border border-white/20 bg-black/75 px-3 py-2 font-sans text-xs text-white/70"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}
      >
        Preparing walk
      </span>
    </>
  );
});

export default MobileWalkTransition;
