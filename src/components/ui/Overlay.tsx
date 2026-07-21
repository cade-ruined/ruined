"use client";

import { useEffect, useRef, useState } from "react";
import { scrollState } from "@/utils/scrollState";
import { CHAPTERS } from "@/components/camera/cameraPath";

// Quiet editorial UI that floats above the 3D world. A vertical wayfinding rail
// on the right shows the whole journey and where the visitor currently is (so
// they always know where they're headed); the current room is named at the
// bottom; a scroll hint fades the moment they start moving. The RUINED wordmark
// is supplied globally by <BrandMark/>, so it isn't repeated here.
export default function Overlay() {
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState(CHAPTERS[0].label);
  const [moved, setMoved] = useState(false);
  const railFill = useRef<HTMLDivElement>(null);
  const railDot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = scrollState.progress;
      // Cheap DOM updates on the rail every frame; React state only when the
      // active chapter or hint visibility actually changes.
      if (railFill.current) railFill.current.style.height = `${p * 100}%`;
      if (railDot.current) railDot.current.style.top = `${p * 100}%`;

      let current = CHAPTERS[0].label;
      for (const c of CHAPTERS) if (p >= c.at) current = c.label;
      setLabel((prev) => (prev === current ? prev : current));
      setMoved((prev) => {
        const m = p > 0.015;
        return prev === m ? prev : m;
      });
      // Only re-render for the numeric readout when the whole-percent changes.
      const pct = Math.round(p * 100);
      setProgress((prev) => (prev === pct ? prev : pct));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 select-none">
      {/* Wayfinding rail */}
      <div className="absolute right-8 top-1/2 h-[46vh] -translate-y-1/2">
        <div className="relative h-full">
          {/* track */}
          <div className="absolute left-0 top-0 h-full w-px bg-white/15" />
          {/* progress fill */}
          <div ref={railFill} className="absolute left-0 top-0 w-px bg-white/70" style={{ height: "0%" }} />
          {/* moving position dot */}
          <div
            ref={railDot}
            className="absolute -left-[3px] h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]"
            style={{ top: "0%" }}
          />
          {/* chapter ticks + labels */}
          {CHAPTERS.map((c) => {
            const active = label === c.label;
            return (
              <div
                key={c.label}
                className="absolute left-0 flex -translate-y-1/2 items-center"
                style={{ top: `${c.at * 100}%` }}
              >
                <span className="block h-px w-2 bg-white/30" />
                <span
                  className={`ml-3 whitespace-nowrap font-mono text-[0.55rem] uppercase tracking-[0.32em] transition-colors duration-500 ${
                    active ? "text-white/90" : "text-white/35"
                  }`}
                >
                  {c.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Current room, centred at the bottom */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center">
        <span
          key={label}
          className="block font-mono text-[0.6rem] uppercase tracking-[0.5em] text-white/70 transition-opacity duration-700"
        >
          {label}
        </span>
      </div>

      {/* Scroll hint — fades away once moving */}
      <div
        className={`absolute bottom-8 left-8 flex items-center gap-3 transition-opacity duration-700 ${
          moved ? "opacity-0" : "opacity-100"
        }`}
      >
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.42em] text-white/50">
          Scroll to walk in
        </span>
        <span className="block h-6 w-px bg-white/40" />
      </div>

      {/* Faint numeric depth cue */}
      <div className="absolute bottom-8 right-8 font-mono text-[0.55rem] tracking-[0.3em] text-white/30">
        {String(progress).padStart(2, "0")}
      </div>
    </div>
  );
}
