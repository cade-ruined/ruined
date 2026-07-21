"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import Overlay from "@/components/ui/Overlay";
import { scrollState } from "@/utils/scrollState";

type Manifest = { count: number; pad: number; ext: string; width: number; height: number };

const frameUrl = (m: Manifest, i: number) =>
  `/frames/frame-${String(i + 1).padStart(m.pad, "0")}.${m.ext}`;

// A scroll-scrubbed image-sequence player — the "Apple keynote" technique. It
// preloads a pre-rendered dolly sequence (produced offline from the very same
// 3D scene) and paints one frame per scroll position onto a canvas. Photoreal
// and perfectly continuous; a fixed rail rather than an interactive world.
export default function FrameSequence() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const framesRef = useRef<HTMLImageElement[]>([]);
  const manifestRef = useRef<Manifest | null>(null);
  const rafRef = useRef(0);
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preload the manifest + all frames.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/frames/manifest.json", { cache: "no-store" });
        if (!res.ok) throw new Error("no manifest");
        const m: Manifest = await res.json();
        manifestRef.current = m;

        const imgs: HTMLImageElement[] = new Array(m.count);
        let done = 0;
        await Promise.all(
          Array.from({ length: m.count }, (_, i) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = img.onerror = () => {
                done += 1;
                if (!cancelled && done % 3 === 0) setLoaded(done);
                resolve();
              };
              img.src = frameUrl(m, i);
              imgs[i] = img;
            })
          )
        );
        if (cancelled) return;
        framesRef.current = imgs;
        setLoaded(m.count);
        setReady(true);
      } catch {
        if (!cancelled) setError("No rendered sequence found yet. Run the capture script.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Canvas painting + scroll scrubbing.
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const m = manifestRef.current!;
    let currentIndex = -1;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      currentIndex = -1;
      paint(scrollState.progress, true);
    };

    const paint = (p: number, force = false) => {
      const idx = Math.min(m.count - 1, Math.max(0, Math.round(p * (m.count - 1))));
      if (idx === currentIndex && !force) return;
      currentIndex = idx;
      const img = framesRef.current[idx];
      if (!img || !img.width) return;
      // cover-fit
      const cw = canvas.width;
      const ch = canvas.height;
      const scale = Math.max(cw / img.width, ch / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    };

    const loop = () => {
      paint(scrollState.progress);
      rafRef.current = requestAnimationFrame(loop);
    };

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ lerp: 0.09 });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const st = ScrollTrigger.create({
      trigger: spacerRef.current!,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => {
        scrollState.progress = self.progress;
      },
    });

    window.addEventListener("resize", resize);
    resize();
    loop();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      st.kill();
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [ready]);

  const total = manifestRef.current?.count ?? 0;
  const pct = total ? Math.round((loaded / total) * 100) : 0;

  return (
    <>
      <div className="fixed inset-0 bg-[#0b0a09]">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>

      {!ready && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[#0b0a09]">
          <div className="text-center">
            <div className="font-mono text-[0.6rem] uppercase tracking-[0.5em] text-white/60">
              {error ?? `Loading sequence ${pct}%`}
            </div>
            {!error && (
              <div className="mx-auto mt-4 h-px w-40 bg-white/15">
                <div className="h-px bg-white/70 transition-[width] duration-200" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {ready && <div ref={spacerRef} aria-hidden style={{ height: "720vh" }} />}
      {ready && <Overlay />}
    </>
  );
}
