"use client";

import { useEffect, useRef } from "react";
import { scrollState } from "@/utils/scrollState";

// Paints a scroll-scrubbed frame sequence onto a full-screen canvas. Frames are
// decoded on demand into a bounded LRU of ImageBitmaps (with forward prefetch),
// so memory stays flat even across hundreds of frames / multiple rooms — we
// never hold the whole sequence decoded at once. Reads normalized progress from
// the shared scrollState singleton (set by the homepage's scroll spring).
export default function RoomSequenceCanvas({
  frames,
  onReady,
}: {
  frames: string[];
  onReady?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!frames.length) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const n = frames.length;

    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const cache = new Map<number, ImageBitmap>();
    const inflight = new Set<number>();
    const queued = new Set<number>();
    let queue: number[] = [];
    const failures = new Map<number, { count: number; retryAt: number }>();
    // Touch gestures cover more frames per input event, so phones receive a
    // deeper directional buffer while retaining a smaller decoded-memory cap.
    const CAP = coarsePointer ? 56 : 96;
    const AHEAD = coarsePointer ? 48 : 36;
    const BEHIND = coarsePointer ? 14 : 12;
    // Unbounded parallel fetches work locally but create head-of-line blocking
    // on a real CDN. Keep the urgent target ahead of speculative neighbours.
    const MAX_INFLIGHT = coarsePointer ? 4 : 8;

    let current = 0;
    let previousTarget = 0;
    let lastDrawn: ImageBitmap | null = null;
    let raf = 0;
    let disposed = false;
    let ready = false;

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

    const decode = async (i: number) => {
      const failed = failures.get(i);
      if (
        disposed ||
        i < 0 ||
        i >= n ||
        cache.has(i) ||
        (failed && (failed.count >= 3 || Date.now() < failed.retryAt))
      ) return;
      try {
        const res = await fetch(frames[i], { cache: "force-cache" });
        if (!res.ok) throw new Error(`Frame ${i} returned ${res.status}`);
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        if (disposed) {
          bmp.close?.();
          return;
        }
        cache.set(i, bmp);
        failures.delete(i);
        evict(current);
        if (!ready) {
          ready = true;
          onReady?.();
        }
      } catch {
        const count = (failures.get(i)?.count ?? 0) + 1;
        failures.set(i, { count, retryAt: Date.now() + 500 * 2 ** (count - 1) });
      } finally {
        inflight.delete(i);
        pump();
      }
    };

    function pump() {
      if (disposed) return;
      while (inflight.size < MAX_INFLIGHT && queue.length) {
        const i = queue.shift();
        if (i === undefined) break;
        queued.delete(i);
        if (cache.has(i) || inflight.has(i)) continue;
        inflight.add(i);
        void decode(i);
      }
    }

    function schedule(i: number, urgent = false) {
      const failed = failures.get(i);
      if (
        disposed ||
        i < 0 ||
        i >= n ||
        cache.has(i) ||
        inflight.has(i) ||
        (failed && (failed.count >= 3 || Date.now() < failed.retryAt))
      ) return;
      if (queued.has(i)) {
        if (urgent) {
          queue = queue.filter((candidate) => candidate !== i);
          queue.unshift(i);
        }
      } else {
        queued.add(i);
        if (urgent) queue.unshift(i);
        else queue.push(i);
      }
      pump();
    }

    const discardStaleQueue = (center: number) => {
      const keepDistance = AHEAD * 2;
      queue = queue.filter((i) => {
        const keep = Math.abs(i - center) <= keepDistance;
        if (!keep) queued.delete(i);
        return keep;
      });
    };

    // Best frame we can show right now: the target if decoded, else the closest
    // decoded neighbour (so fast scrubbing never blanks the canvas).
    const nearest = (i: number): ImageBitmap | undefined => {
      if (cache.has(i)) return cache.get(i);
      for (let d = 1; d < n; d++) {
        if (cache.has(i - d)) return cache.get(i - d);
        if (cache.has(i + d)) return cache.get(i + d);
        if (d > CAP + AHEAD) break;
      }
      return undefined;
    };

    const resize = () => {
      const dpr = Math.min(coarsePointer ? 1.5 : 2, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      lastDrawn = null;
    };

    const draw = (bmp: ImageBitmap) => {
      const cw = canvas.width;
      const ch = canvas.height;
      const s = Math.max(cw / bmp.width, ch / bmp.height);
      const w = bmp.width * s;
      const h = bmp.height * s;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(bmp, (cw - w) / 2, (ch - h) / 2, w, h);
      lastDrawn = bmp;
    };

    const loop = () => {
      const p = Math.min(1, Math.max(0, scrollState.progress));
      const target = Math.round(p * (n - 1));
      const direction = target < previousTarget ? -1 : 1;
      if (target !== previousTarget) discardStaleQueue(target);
      current = target;
      schedule(target, true);
      for (let k = 1; k <= AHEAD; k++) schedule(target + direction * k);
      for (let k = 1; k <= BEHIND; k++) schedule(target - direction * k);
      const bmp = nearest(target);
      if (bmp && bmp !== lastDrawn) draw(bmp);
      previousTarget = target;
      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    for (let k = 0; k < AHEAD; k++) schedule(k, k === 0); // warm the opening
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      cache.forEach((b) => b.close?.());
      cache.clear();
      queue = [];
      queued.clear();
      failures.clear();
    };
  }, [frames, onReady]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full [contain:strict]"
    />
  );
}
