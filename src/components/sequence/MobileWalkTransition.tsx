"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type RefObject,
} from "react";
import { MOBILE_WALK_TRANSITIONS } from "@/data/mobileJourney";
import { versionSequenceAsset } from "@/data/sequences";

const SOURCE_FRAME_COUNT = 192;
const TRANSITION_FRAME_STRIDE = 16;
const TRANSITION_DURATION_MS = 520;
const ARRIVAL_HOLD_MS = 70;
const FRAME_WAIT_TIMEOUT_MS = 4000;
const MAX_FRAME_FAILURES = 2;
const MAX_DECODED_PIXELS = 16_000_000;
const TRANSITION_FRAME_NUMBERS = [
  ...Array.from(
    { length: Math.floor((SOURCE_FRAME_COUNT - 1) / TRANSITION_FRAME_STRIDE) + 1 },
    (_, index) => index * TRANSITION_FRAME_STRIDE + 1
  ),
  SOURCE_FRAME_COUNT,
];
const FRAMES_PER_TRANSITION = TRANSITION_FRAME_NUMBERS.length;
const TRANSITION_FRAMES = MOBILE_WALK_TRANSITIONS.flatMap(
  ({ room, startFrame, endFrame }) =>
    TRANSITION_FRAME_NUMBERS.map((frame, index) => {
      const path =
        index === 0
          ? startFrame
          : index === TRANSITION_FRAME_NUMBERS.length - 1
            ? endFrame
            : `/sequences/${room}/frame-${String(frame).padStart(4, "0")}.webp`;
      return versionSequenceAsset(path);
    })
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
      return await createImageBitmap(blob, {
        resizeWidth: 828,
        resizeHeight: 466,
        resizeQuality: "medium",
      });
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
    const inflight = new Set<number>();
    const queued = new Set<number>();
    const failureCounts = new Map<number, number>();
    const waiters = new Map<number, Set<(ready: boolean) => void>>();
    const controller = new AbortController();
    const CAP = FRAMES_PER_TRANSITION * 2;
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
    let disposed = false;

    const groupFor = (index: number) =>
      Math.min(
        MOBILE_WALK_TRANSITIONS.length - 1,
        Math.floor(index / FRAMES_PER_TRANSITION)
      );

    const draw = (frame: DecodedFrame, index: number) => {
      const scale = Math.max(
        canvas.width / frame.width,
        canvas.height / frame.height
      );
      const width = frame.width * scale;
      const height = frame.height * scale;
      context.fillStyle = "#080605";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        frame,
        (canvas.width - width) / 2,
        (canvas.height - height) / 2,
        width,
        height
      );
      lastDrawn = index;
      canvas.style.opacity = "1";
      journey.toggleAttribute("data-walking", true);
    };

    const nearest = (index: number): [number, DecodedFrame] | undefined => {
      const exact = cache.get(index);
      if (exact) return [index, exact];

      const group = groupFor(index);
      const start = group * FRAMES_PER_TRANSITION;
      const end = start + FRAMES_PER_TRANSITION - 1;
      for (let distance = 1; distance < FRAMES_PER_TRANSITION; distance += 1) {
        const before = index - distance;
        const after = index + distance;
        if (before >= start && cache.has(before)) {
          return [before, cache.get(before)!];
        }
        if (after <= end && cache.has(after)) {
          return [after, cache.get(after)!];
        }
      }
      return undefined;
    };

    const renderTarget = () => {
      if (activeSegment < 0) return;
      const available = nearest(target);
      if (available && available[0] !== lastDrawn) {
        draw(available[1], available[0]);
      }
    };

    const evict = () => {
      let decodedPixels = [...cache.values()].reduce(
        (total, frame) => total + frame.width * frame.height,
        0
      );
      if (cache.size <= CAP && decodedPixels <= MAX_DECODED_PIXELS) return;
      const segmentStart = activeSegment * FRAMES_PER_TRANSITION;
      const segmentEnd = segmentStart + FRAMES_PER_TRANSITION - 1;
      const candidates = [...cache.keys()]
        .filter(
          (index) =>
            activeSegment < 0 ||
            (index !== segmentStart && index !== segmentEnd)
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

    const decode = async (index: number) => {
      let ready = false;
      try {
        const response = await fetch(TRANSITION_FRAMES[index], {
          cache: "force-cache",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Frame returned ${response.status}`);
        const frame = await decodeFrame(await response.blob());
        if (disposed) {
          releaseFrame(frame);
          return;
        }
        cache.set(index, frame);
        failureCounts.delete(index);
        ready = true;
        evict();
        renderTarget();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          failureCounts.set(index, (failureCounts.get(index) ?? 0) + 1);
        }
      } finally {
        inflight.delete(index);
        resolveWaiters(index, ready);
        pump();
      }
    };

    function pump() {
      if (disposed) return;
      while (inflight.size < MAX_INFLIGHT && queue.length) {
        const index = queue.shift();
        if (index === undefined) break;
        queued.delete(index);
        if (
          cache.has(index) ||
          inflight.has(index) ||
          (failureCounts.get(index) ?? 0) >= MAX_FRAME_FAILURES
        ) {
          continue;
        }
        inflight.add(index);
        void decode(index);
      }
    }

    const schedule = (index: number, urgent = false) => {
      if (
        index < 0 ||
        index >= TRANSITION_FRAMES.length ||
        cache.has(index) ||
        inflight.has(index) ||
        (failureCounts.get(index) ?? 0) >= MAX_FRAME_FAILURES
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
      if (
        (failureCounts.get(index) ?? 0) >= MAX_FRAME_FAILURES ||
        disposed
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

    const warmTransition = (segment: number, reverse = false) => {
      if (segment < 0 || segment >= MOBILE_WALK_TRANSITIONS.length) return;
      const start = segment * FRAMES_PER_TRANSITION;
      const offsets = Array.from(
        { length: FRAMES_PER_TRANSITION },
        (_, index) => index
      );
      if (reverse) offsets.reverse();
      offsets.forEach((offset) => schedule(start + offset));
    };

    const prepare = (sceneIndex: number) => {
      if (reducedMotion.matches) return;
      target =
        sceneIndex === 0
          ? 0
          : (sceneIndex - 1) * FRAMES_PER_TRANSITION +
            FRAMES_PER_TRANSITION -
            1;
      warmTransition(sceneIndex);
      warmTransition(sceneIndex - 1, true);
    };

    const hideCanvas = () => {
      activeSegment = -1;
      lastDrawn = -1;
      canvas.style.opacity = "0";
      journey.removeAttribute("data-walking");
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
      if (!reducedMotion.matches) return;
      pendingOnStart?.();
      pendingOnStart = null;
      resolveWaiters(target, false);
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
      const segment = Math.min(fromIndex, toIndex);
      const frameStart = segment * FRAMES_PER_TRANSITION;
      const startIndex =
        frameStart + (forward ? 0 : FRAMES_PER_TRANSITION - 1);
      const endIndex =
        frameStart + (forward ? FRAMES_PER_TRANSITION - 1 : 0);

      activeSegment = segment;
      target = startIndex;
      lastDrawn = -1;
      warmTransition(segment, !forward);

      const [startReady, endReady] = await Promise.all([
        ensure(startIndex),
        ensure(endIndex),
      ]);
      if (disposed || token !== playToken) return false;
      if (!startReady || !endReady) {
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

      draw(startFrame, startIndex);
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
          const position = Math.round(
            progress * (FRAMES_PER_TRANSITION - 1)
          );
          const offset = forward
            ? position
            : FRAMES_PER_TRANSITION - 1 - position;
          target = frameStart + offset;
          schedule(target, true);
          schedule(target + (forward ? 1 : -1));
          renderTarget();

          if (progress < 1) {
            playRaf = requestAnimationFrame(tick);
            return;
          }

          void ensure(endIndex).then((ready) => {
            if (token !== playToken || disposed) return;
            const endpoint = cache.get(endIndex);
            if (ready && endpoint) draw(endpoint, endIndex);
            holdTimer = window.setTimeout(
              () => finishWalk(toIndex, token),
              ARRIVAL_HOLD_MS
            );
          });
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
      controller.abort();
      cancelAnimationFrame(playRaf);
      window.clearTimeout(holdTimer);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      reducedMotion.removeEventListener("change", handleReducedMotionChange);
      hideCanvas();
      pendingOnStart = null;
      activeResolve?.(false);
      activeResolve = null;
      waiters.forEach((pending) =>
        pending.forEach((resolve) => resolve(false))
      );
      waiters.clear();
      cache.forEach(releaseFrame);
      cache.clear();
      queue = [];
      queued.clear();
      prepareRef.current = () => undefined;
      playRef.current = async (_fromIndex, _toIndex, onStart) => {
        onStart();
        return false;
      };
    };
  }, [journeyRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="ruined-mobile-walk"
    />
  );
});

export default MobileWalkTransition;
