"use client";

import { Suspense, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import World from "@/components/world/World";
import Lighting from "@/components/lights/Lighting";
import CameraRig from "@/components/camera/CameraRig";
import PostFX from "@/components/experience/PostFX";
import Overlay from "@/components/ui/Overlay";
import { scrollState } from "@/utils/scrollState";
import { captureState } from "@/utils/captureState";
import { DIMS } from "@/components/world/config";

const BG = "#0b0a09";

// Is the page loaded with ?capture — i.e. an offline render tool is driving the
// camera frame-by-frame rather than a human scrolling.
const isCapture = () =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("capture");

// Signals to the render script (via window.__ruinedReady) that every texture is
// loaded and the first frame is safe to grab.
function CaptureBridge() {
  const { progress, active } = useProgress();
  useEffect(() => {
    if (!active && progress >= 100) {
      (window as unknown as { __ruinedReady?: boolean }).__ruinedReady = true;
    }
  }, [progress, active]);
  return null;
}

// The root of the immersive experience: a fixed full-screen WebGL canvas (the
// building) with a tall invisible scroll spacer behind it. Lenis smooth-scrolls
// the page; ScrollTrigger turns that scroll into normalized progress; the camera
// rig rides the spline. The page barely moves — the world does.
export default function Experience() {
  const spacerRef = useRef<HTMLDivElement>(null);
  const capture = isCapture();

  useEffect(() => {
    if (capture) {
      // Deterministic offline render: let an external script set progress.
      captureState.active = true;
      (window as unknown as { __ruinedSetProgress?: (p: number) => void }).__ruinedSetProgress = (p) => {
        scrollState.progress = Math.min(1, Math.max(0, p));
      };
      return () => {
        captureState.active = false;
      };
    }

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

    return () => {
      st.kill();
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [capture]);

  return (
    <>
      <div className="fixed inset-0" style={{ background: BG }}>
        <Canvas
          dpr={capture ? 1 : [1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: capture }}
          camera={{ fov: 44, near: 0.1, far: 200, position: [0, DIMS.eye, 4] }}
        >
          <color attach="background" args={[BG]} />
          <fog attach="fog" args={[BG, 24, 74]} />
          <Suspense fallback={null}>
            <World />
          </Suspense>
          <Lighting />
          <CameraRig />
          <PostFX />
          {capture && <CaptureBridge />}
        </Canvas>
      </div>

      {!capture && <div ref={spacerRef} aria-hidden style={{ height: "720vh" }} />}

      {!capture && <Overlay />}
    </>
  );
}
