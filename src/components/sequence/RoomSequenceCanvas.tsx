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

    const cache = new Map<number, ImageBitmap>();
    const inflight = new Set<number>();
    const failures = new Map<number, { count: number; retryAt: number }>();
    const CAP = 72; // max decoded frames kept in memory
    const AHEAD = 24; // prefetch forward (scroll is usually downward)
    const BEHIND = 8;

    let current = 0;
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
        inflight.has(i) ||
        (failed && (failed.count >= 3 || Date.now() < failed.retryAt))
      ) return;
      inflight.add(i);
      try {
        const res = await fetch(frames[i]);
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
      }
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
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };

    const draw = (bmp: ImageBitmap) => {
      const cw = canvas.width;
      const ch = canvas.height;
      const s = Math.max(cw / bmp.width, ch / bmp.height);
      const w = bmp.width * s;
      const h = bmp.height * s;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(bmp, (cw - w) / 2, (ch - h) / 2, w, h);
    };

    const loop = () => {
      const p = Math.min(1, Math.max(0, scrollState.progress));
      const target = Math.round(p * (n - 1));
      current = target;
      decode(target);
      for (let k = 1; k <= AHEAD; k++) decode(target + k);
      for (let k = 1; k <= BEHIND; k++) decode(target - k);
      const bmp = nearest(target);
      if (bmp) draw(bmp);
      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    for (let k = 0; k < AHEAD; k++) decode(k); // warm the opening
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      cache.forEach((b) => b.close?.());
      cache.clear();
      failures.clear();
    };
  }, [frames, onReady]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}
