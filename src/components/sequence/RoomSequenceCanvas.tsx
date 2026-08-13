"use client";

import { useEffect, useRef } from "react";
import { scrollState } from "@/utils/scrollState";
import {
  sequenceAssetFocalX,
  sequenceCoverRect,
} from "@/utils/sequenceFraming";

// Paints a scroll-scrubbed frame sequence onto a full-screen canvas. Frames are
// decoded on demand into a bounded LRU of ImageBitmaps (with forward prefetch),
// so memory stays flat even across hundreds of frames / multiple rooms — we
// never hold the whole sequence decoded at once. Reads normalized progress from
// the shared scrollState singleton (set by the homepage's scroll spring).
export default function RoomSequenceCanvas({
  frames,
}: {
  frames: string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!frames.length) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { desynchronized: true })!;
    const n = frames.length;
    // Nearest-frame fallback may bridge small decode gaps, but it must never
    // cross a room boundary and flash a different scene at the seam.
    const frameGroups = frames.map((frame) =>
      frame.split("?", 1)[0].split("/").slice(0, -1).join("/")
    );

    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const cache = new Map<number, ImageBitmap>();
    const inflight = new Map<number, AbortController>();
    const urgentInflight = new Set<number>();
    const queued = new Set<number>();
    const urgentQueued = new Set<number>();
    let queue: number[] = [];
    const failures = new Map<number, { count: number; retryAt: number }>();
    // Each decoded 1920 × 1080 frame costs roughly 7.9 MiB. Keep the working set
    // tight enough to avoid memory-pressure pauses while still covering a
    // normal wheel/trackpad burst in both directions.
    const CAP = coarsePointer ? 32 : 48;
    const AHEAD = coarsePointer ? 20 : 24;
    const BEHIND = 8;
    // Unbounded parallel fetches work locally but create head-of-line blocking
    // on a real CDN. Reserve one lane for the exact requested frame instead
    // of cancelling useful prefetches every time the scroll target advances.
    const MAX_INFLIGHT = coarsePointer ? 3 : 4;
    const MAX_SPECULATIVE_INFLIGHT = MAX_INFLIGHT - 1;

    let current = 0;
    let previousTarget = -1;
    let direction = 1;
    let lastDrawn: ImageBitmap | null = null;
    let lastDrawnGroup: string | null = null;
    let raf = 0;
    let disposed = false;
    let hasPaintedExactTarget = false;

    const evict = (center: number) => {
      if (cache.size <= CAP) return;
      const keys = [...cache.keys()].sort(
        (a, b) => Math.abs(b - center) - Math.abs(a - center)
      );
      while (cache.size > CAP) {
        const k = keys.shift();
        if (k === undefined) break;
        cache.get(k)?.close?.();
        cache.delete(k);
      }
    };

    const decode = async (i: number, controller: AbortController) => {
      const failed = failures.get(i);
      if (
        disposed ||
        i < 0 ||
        i >= n ||
        cache.has(i) ||
        (failed && (failed.count >= 3 || Date.now() < failed.retryAt))
      ) return;
      try {
        const res = await fetch(frames[i], {
          cache: "force-cache",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Frame ${i} returned ${res.status}`);
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        if (disposed || controller.signal.aborted) {
          bmp.close?.();
          return;
        }
        cache.set(i, bmp);
        failures.delete(i);
        evict(current);
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        const count = (failures.get(i)?.count ?? 0) + 1;
        failures.set(i, { count, retryAt: Date.now() + 500 * 2 ** (count - 1) });
      } finally {
        if (inflight.get(i) === controller) {
          inflight.delete(i);
          urgentInflight.delete(i);
        }
        pump();
      }
    };

    function pump() {
      if (disposed) return;
      while (inflight.size < MAX_INFLIGHT && queue.length) {
        const urgentQueueIndex = queue.findIndex((i) => urgentQueued.has(i));
        if (
          urgentQueueIndex < 0 &&
          inflight.size - urgentInflight.size >= MAX_SPECULATIVE_INFLIGHT
        ) {
          break;
        }
        const queueIndex = urgentQueueIndex >= 0 ? urgentQueueIndex : 0;
        const [i] = queue.splice(queueIndex, 1);
        if (i === undefined) break;
        const urgent = urgentQueued.delete(i);
        queued.delete(i);
        if (cache.has(i) || inflight.has(i)) continue;
        const controller = new AbortController();
        inflight.set(i, controller);
        if (urgent) urgentInflight.add(i);
        void decode(i, controller);
      }
    }

    function schedule(i: number, urgent = false) {
      const failed = failures.get(i);
      if (
        disposed ||
        i < 0 ||
        i >= n
      ) return;
      if (urgent) {
        // Urgency belongs only to the latest scroll target. Older exact-frame
        // requests remain useful prefetches, but must not crowd ahead of it.
        urgentQueued.clear();
        urgentInflight.clear();
      }
      if (
        cache.has(i) ||
        (failed && (failed.count >= 3 || Date.now() < failed.retryAt))
      ) return;
      if (inflight.has(i)) {
        // A prefetched frame that becomes the exact target is already doing the
        // right work. Promote it so it no longer consumes speculative capacity.
        if (urgent) urgentInflight.add(i);
        return;
      }
      if (queued.has(i)) {
        if (urgent) {
          urgentQueued.add(i);
          queue = queue.filter((candidate) => candidate !== i);
          queue.unshift(i);
        }
      } else {
        queued.add(i);
        if (urgent) {
          urgentQueued.add(i);
          queue.unshift(i);
        } else {
          queue.push(i);
        }
      }
      pump();
    }

    const discardStaleWork = (center: number) => {
      const keepDistance = AHEAD + BEHIND;
      queue = queue.filter((i) => {
        const keep = Math.abs(i - center) <= keepDistance;
        if (!keep) {
          queued.delete(i);
          urgentQueued.delete(i);
        }
        return keep;
      });
      inflight.forEach((controller, i) => {
        if (Math.abs(i - center) > keepDistance) {
          controller.abort();
          inflight.delete(i);
          urgentInflight.delete(i);
        }
      });
    };

    // Best frame we can show right now: the target if decoded, else the closest
    // decoded neighbour (so fast scrubbing never blanks the canvas).
    const nearest = (i: number): ImageBitmap | undefined => {
      if (cache.has(i)) return cache.get(i);
      const group = frameGroups[i];
      for (let d = 1; d < n; d++) {
        if (frameGroups[i - d] === group && cache.has(i - d)) {
          return cache.get(i - d);
        }
        if (frameGroups[i + d] === group && cache.has(i + d)) {
          return cache.get(i + d);
        }
        if (d > CAP + AHEAD) break;
      }
      return undefined;
    };

    const resize = () => {
      // Source frames are 1920 × 1080, so a Retina-scale backing store adds
      // interpolation and fill cost without revealing additional source detail.
      const dpr = Math.min(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.globalCompositeOperation = "copy";
      lastDrawn = null;
      lastDrawnGroup = null;
    };

    const draw = (bmp: ImageBitmap, group: string, frameIndex: number) => {
      const cw = canvas.width;
      const ch = canvas.height;
      const rect = sequenceCoverRect(
        bmp.width,
        bmp.height,
        cw,
        ch,
        sequenceAssetFocalX(frames[frameIndex])
      );
      ctx.drawImage(bmp, rect.x, rect.y, rect.width, rect.height);
      lastDrawn = bmp;
      lastDrawnGroup = group;
    };

    const blankForGroup = (group: string) => {
      // A transparent clear would expose the lobby poster underneath. Paint an
      // opaque neutral frame so a previous room can never linger at a seam.
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      lastDrawn = null;
      lastDrawnGroup = group;
    };

    const loop = () => {
      const p = Math.min(1, Math.max(0, scrollState.progress));
      const target = Math.round(p * (n - 1));
      const targetChanged = target !== previousTarget;
      if (targetChanged) {
        direction = target < previousTarget ? -1 : 1;
        discardStaleWork(target);
      }
      current = target;
      schedule(target, true);
      if (targetChanged) {
        for (let k = 1; k <= AHEAD; k++) schedule(target + direction * k);
        for (let k = 1; k <= BEHIND; k++) schedule(target - direction * k);
      }
      // Keep the sequence-derived opening frame underneath the transparent
      // canvas until the exact requested target is available. A neighbouring
      // decode must never win the opening race and create a visible frame jump.
      const bmp = hasPaintedExactTarget ? nearest(target) : cache.get(target);
      const targetGroup = frameGroups[target];
      if (bmp && bmp !== lastDrawn) {
        draw(bmp, targetGroup, target);
        hasPaintedExactTarget = true;
      } else if (
        hasPaintedExactTarget &&
        !bmp &&
        lastDrawnGroup !== targetGroup
      ) {
        blankForGroup(targetGroup);
      }
      previousTarget = target;
      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      inflight.forEach((controller) => controller.abort());
      inflight.clear();
      urgentInflight.clear();
      cache.forEach((b) => b.close?.());
      cache.clear();
      queue = [];
      queued.clear();
      urgentQueued.clear();
      failures.clear();
    };
  }, [frames]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full [contain:strict]"
    />
  );
}
