"use client";

// A virtual CAMERA, not a webpage.
//
// The four rooms — lobby, store, records, lounge — are textured planes stacked
// one behind the other in a real perspective scene. Each plane (except the
// last) has a portal-shaped hole cut into it, aligned to a real opening in the
// photograph (the steel doorway, the spiral-stair hatch, the far doorway), so
// the architecture around it stays solid and becomes the mask. The next room
// sits further back in Z, visible THROUGH that hole. A perspective camera
// physically dollies forward, station to station, PASSING THROUGH each opening
// into the next room — steering toward the opening as it approaches (a straight
// push for the centred doorways, a drift-and-drop for the off-centre staircase
// descent into the records room). Rooms are never crossfaded; the opening hides
// every cut.
//
// Scroll drives the camera via Lenis (smooth scroll) + GSAP ScrollTrigger (a
// pinned section). Rendering is WebGL (Three.js) on one canvas at 60fps.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

// ── Stage tuning ─────────────────────────────────────────────────────────
const FOV = 30; // long-ish lens → less wide-angle distortion, more "dolly"
const VIEW_DIST = 4.2; // distance at which a room exactly fills the frame
const GAP = VIEW_DIST; // depth between rooms; == VIEW_DIST so each pass-through
//                        blows the opening out to full-frame right as we arrive
const IMG_ASPECT = 1600 / 1200; // scene photos are 4:3
const OVERSCAN = 1.08; // planes fill slightly beyond frame so the breathing
//                        drift never exposes a photo edge

type Portal = {
  // centre in the photo's own UV space (v measured from the BOTTOM), and the
  // half-size of the rectangular hole, all as fractions of the photo. `pull`
  // scales how far the camera slides toward the opening as it passes through
  // (1 = dead-centre on it; lower = a gentler steer, for soft/large openings).
  x: number;
  y: number;
  hx: number;
  hy: number;
  feather: number;
  pull: number;
};

type SceneDef = { src: string; label: string; portal?: Portal };

// Portals sit just inside each real opening so the frame/jamb stays solid.
const SCENES: SceneDef[] = [
  {
    src: "/dive-lobby.jpg",
    label: "Lobby",
    // centred steel doorway → store
    portal: { x: 0.5, y: 0.54, hx: 0.12, hy: 0.3, feather: 0.012, pull: 1 },
  },
  {
    src: "/dive-store.jpg",
    label: "Store",
    // spiral-stair hatch, bottom-right, glowing → records (a descent)
    portal: { x: 0.78, y: 0.12, hx: 0.14, hy: 0.12, feather: 0.05, pull: 0.9 },
  },
  {
    src: "/dive-records.jpg",
    label: "Records",
    // centred far doorway → lounge
    portal: { x: 0.5, y: 0.46, hx: 0.085, hy: 0.16, feather: 0.02, pull: 1 },
  },
  { src: "/dive-lounge.jpg", label: "Lounge" },
];

// Scroll timeline: brief holds to appreciate each room, longer eased moves to
// push through the openings. Lengths are fractions of the pinned scroll and
// must sum to 1.
const TIMELINE: { type: "hold" | "move"; scene: number; len: number }[] = [
  { type: "hold", scene: 0, len: 0.06 },
  { type: "move", scene: 0, len: 0.26 },
  { type: "hold", scene: 1, len: 0.06 },
  { type: "move", scene: 1, len: 0.26 },
  { type: "hold", scene: 2, len: 0.06 },
  { type: "move", scene: 2, len: 0.24 },
  { type: "hold", scene: 3, len: 0.06 },
];

const smootherstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform float uImgAspect;
  uniform float uPlaneAspect;
  uniform bool uHasDoor;
  uniform vec2 uDoorCenter;
  uniform vec2 uDoorHalf;
  uniform float uDoorFeather;
  // object-cover: fill the plane, crop the photo, never distort it
  vec2 coverUv(vec2 uv){
    vec2 s = vec2(1.0);
    if (uPlaneAspect > uImgAspect) { s.y = uImgAspect / uPlaneAspect; }
    else { s.x = uPlaneAspect / uImgAspect; }
    return (uv - 0.5) * s + 0.5;
  }
  void main(){
    vec2 iuv = coverUv(vUv);
    vec3 col = texture2D(uMap, iuv).rgb;
    float alpha = 1.0;
    if (uHasDoor){
      vec2 d = abs(iuv - uDoorCenter);
      float ax = smoothstep(uDoorHalf.x - uDoorFeather, uDoorHalf.x + uDoorFeather, d.x);
      float ay = smoothstep(uDoorHalf.y - uDoorFeather, uDoorHalf.y + uDoorFeather, d.y);
      alpha = max(ax, ay); // 0 only inside the rectangle → the hole
      if (alpha < 0.01) discard;
    }
    gl_FragColor = vec4(col, alpha);
  }
`;

export default function CameraDive() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    const pin = pinRef.current;
    if (!canvas || !section || !pin) return;

    THREE.ColorManagement.enabled = false; // show the JPEGs exactly as authored
    gsap.registerPlugin(ScrollTrigger);

    const N = SCENES.length;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);
    const geom = new THREE.PlaneGeometry(1, 1, 1, 1);

    const meshes: THREE.Mesh[] = [];
    // Each room is placed centred on the SIGHTLINE through the opening it's seen
    // through, so the camera just follows the chain of openings and every room
    // lands centred. offsets[i] = world (x,y) of room i's centre.
    const offsets: THREE.Vector2[] = SCENES.map(() => new THREE.Vector2());

    let raf = 0;
    let lenis: Lenis | null = null;
    let st: ScrollTrigger | null = null;
    const clock = new THREE.Clock();

    const fillSize = (dist: number) => {
      const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
      return { w: h * camera.aspect, h };
    };

    const makeMesh = (texture: THREE.Texture, portal?: Portal) => {
      texture.colorSpace = THREE.NoColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: texture },
          uImgAspect: { value: IMG_ASPECT },
          uPlaneAspect: { value: 1 },
          uHasDoor: { value: !!portal },
          uDoorCenter: {
            value: new THREE.Vector2(portal?.x ?? 0.5, portal?.y ?? 0.5),
          },
          uDoorHalf: {
            value: new THREE.Vector2(portal?.hx ?? 0.1, portal?.hy ?? 0.1),
          },
          uDoorFeather: { value: portal?.feather ?? 0.02 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: !!portal,
        depthWrite: !portal,
        depthTest: true,
      });
      return new THREE.Mesh(geom, mat);
    };

    const layout = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      const base = fillSize(VIEW_DIST);
      const pw = base.w * OVERSCAN;
      const ph = base.h * OVERSCAN;
      const planeAspect = pw / ph; // === camera.aspect
      // inverse of the shader's cover mapping (plane-uv from image-uv)
      const sx = planeAspect > IMG_ASPECT ? 1 : planeAspect / IMG_ASPECT;
      const sy = planeAspect > IMG_ASPECT ? IMG_ASPECT / planeAspect : 1;

      // local (x,y) of each room's opening, on a centred plane
      const local = SCENES.map((sc) => {
        if (!sc.portal) return new THREE.Vector2();
        const puvx = (sc.portal.x - 0.5) / sx + 0.5;
        const puvy = (sc.portal.y - 0.5) / sy + 0.5;
        return new THREE.Vector2((puvx - 0.5) * pw, (puvy - 0.5) * ph);
      });
      // chain the openings: room i+1 is centred where room i's opening points
      offsets[0].set(0, 0);
      for (let i = 1; i < N; i++) {
        offsets[i].set(
          offsets[i - 1].x + local[i - 1].x,
          offsets[i - 1].y + local[i - 1].y
        );
      }

      meshes.forEach((mesh, i) => {
        mesh.scale.set(pw, ph, 1);
        (mesh.material as THREE.ShaderMaterial).uniforms.uPlaneAspect.value =
          planeAspect;
        mesh.position.set(offsets[i].x, offsets[i].y, -i * GAP);
      });
    };

    // Resolve scroll progress → camera station (float scene index). Holds sit at
    // integer stations; moves ease between them.
    const resolve = (p: number) => {
      let acc = 0;
      for (const seg of TIMELINE) {
        if (p <= acc + seg.len || seg === TIMELINE[TIMELINE.length - 1]) {
          const f = seg.len > 0 ? (p - acc) / seg.len : 0;
          return seg.type === "hold"
            ? seg.scene
            : seg.scene + smootherstep(f);
        }
        acc += seg.len;
      }
      return 0;
    };

    const renderFrame = () => {
      const p = progressRef.current;
      const t = clock.getElapsedTime();
      const s = resolve(p);

      // Follow the chain of room centres: interpolate the camera's (x,y) between
      // the two bracketing stations, and dolly forward one GAP per station. This
      // steers the camera straight through each opening — a forward push for the
      // centred doorways, a drift-and-drop for the off-centre stair hatch.
      const i0 = Math.min(Math.floor(s), N - 1);
      const i1 = Math.min(i0 + 1, N - 1);
      const f = s - i0;
      const camX = THREE.MathUtils.lerp(offsets[i0].x, offsets[i1].x, f);
      const camY = THREE.MathUtils.lerp(offsets[i0].y, offsets[i1].y, f);
      const camZ = VIEW_DIST - s * GAP;

      // Phase-1 arrival breathing only (fades out the instant we push in).
      const calm = 1 - smoothstep(0.0, 0.055, p);
      camera.rotation.set(0, 0, 0); // vanishing point stays locked at centre
      camera.position.x = camX + Math.sin(t * 0.24) * 0.03 * calm;
      camera.position.y = camY + Math.cos(t * 0.31) * 0.02 * calm;
      camera.position.z = camZ + Math.sin(t * 0.4) * 0.02 * calm;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(renderFrame);
    };

    const loader = new THREE.TextureLoader();
    const load = (url: string) =>
      new Promise<THREE.Texture>((res, rej) =>
        loader.load(url, res, undefined, rej)
      );

    let disposed = false;
    Promise.all(SCENES.map((sc) => load(sc.src)))
      .then((textures) => {
        if (disposed) return;
        // Build far → near so the render order (far first) is correct.
        for (let i = N - 1; i >= 0; i--) {
          const mesh = makeMesh(textures[i], SCENES[i].portal);
          mesh.position.z = -i * GAP;
          mesh.renderOrder = N - 1 - i; // lobby (i0) drawn last, on top
          meshes[i] = mesh;
          scene.add(mesh);
        }

        layout();

        lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
        lenis.on("scroll", ScrollTrigger.update);
        gsap.ticker.add((time) => lenis?.raf(time * 1000));
        gsap.ticker.lagSmoothing(0);

        st = ScrollTrigger.create({
          trigger: section,
          start: "top top",
          end: "bottom bottom",
          pin: pin,
          pinSpacing: true,
          onUpdate: (self) => {
            progressRef.current = self.progress;
          },
        });

        setReady(true);
        clock.start();
        raf = requestAnimationFrame(renderFrame);
      })
      .catch((e) => console.error("CameraDive: texture load failed", e));

    window.addEventListener("resize", layout);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", layout);
      st?.kill();
      lenis?.destroy();
      geom.dispose();
      for (const mesh of meshes) {
        if (!mesh) continue;
        (mesh.material as THREE.ShaderMaterial).uniforms.uMap.value?.dispose?.();
        (mesh.material as THREE.ShaderMaterial).dispose();
      }
      renderer.dispose();
    };
  }, []);

  return (
    <section ref={sectionRef} className="relative bg-black" style={{ height: "620vh" }}>
      <div ref={pinRef} className="relative h-screen w-full overflow-hidden bg-black">
        <canvas ref={canvasRef} className="block h-full w-full" />

        {/* Premium, quiet editorial overlay. The RUINED wordmark is provided
            globally by <BrandMark/> in the layout, so it's intentionally not
            repeated here (avoids a double logo). */}
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-1000 ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="absolute inset-x-0 bottom-10 flex flex-col items-center gap-2">
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.42em] text-white/60">
              Scroll to enter
            </span>
            <span className="block h-8 w-px bg-white/40" />
          </div>
        </div>

        {/* Load veil */}
        <div
          className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-black transition-opacity duration-700 ${
            ready ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.5em] text-white/50">
            Ruined
          </span>
        </div>
      </div>
    </section>
  );
}
