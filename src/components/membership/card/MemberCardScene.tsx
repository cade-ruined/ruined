"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CardArtwork } from "./card-artwork";
import { createMemberCardGeometry } from "./card-geometry";
import { createCardFaceMaterial } from "./card-foil-material";
import { CARD_CAMERA, CARD_REST_ROTATION, cardBoundsCorners, cardGroundHeight, nextCardCameraDistance, requiredCardCameraDistance, restingCardCameraDistance } from "./card-framing";
import { getArchiveLightLayout, type ArchiveLightLayout, type ArchiveShadow } from "./archive-lighting";
import { archiveLampPosition, createArchiveTableCalibration, projectArchiveShadow, type ArchiveStageRect, type ArchiveTableCalibration } from "./archive-card-lighting";

export type CardPose = { x: number; y: number; tiltX: number; tiltY: number; roll: number; lifted: boolean; side: "front" | "back"; reduced: boolean; reset: number };
const REST_YAW = CARD_REST_ROTATION.y;
const nearestAngle = (current: number, target: number) => current + Math.atan2(Math.sin(target - current), Math.cos(target - current));

type SurfaceArtwork = CardArtwork & {
  frontRoughness?: HTMLCanvasElement; backRoughness?: HTMLCanvasElement;
  frontBump?: HTMLCanvasElement; backBump?: HTMLCanvasElement; materialSeed?: string;
  frontFoilMask?: HTMLCanvasElement; backFoilMask?: HTMLCanvasElement;
};
type SceneProps = { artwork: CardArtwork; pose: CardPose; visible: boolean; onReady: () => void; onLost: () => void; archive?: boolean; onArchiveShadow?: (shadow: ArchiveShadow | null) => void };
type RoomRegistration = { layout: ArchiveLightLayout; rect: ArchiveStageRect; revision: number };
const ARCHIVE_ENV_SOURCE = new THREE.Vector3(0, 4, 2).normalize();

/** Large photographic softboxes; their reflection moves across the actual warped stock. */
function studioEnvironment(renderer: THREE.WebGLRenderer, archive = false) {
  const studio = new THREE.Scene(); studio.background = new THREE.Color(archive ? "#070605" : "#111510");
  const panels: THREE.Mesh[] = [];
  const panel = (width: number, height: number, position: [number, number, number], color: string, strength: number) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(...position); mesh.lookAt(0, 0, 0); studio.add(mesh); panels.push(mesh);
  };
  if (archive) {
    // A small warm fixture and faint room bounce, without the studio's tall strips.
    panel(.8, .45, [0, 4, 2], "#ffe0ac", 5);
    panel(8, 5, [0, -4, 1], "#bd9c73", .35);
    panel(9, 7, [0, 1, 7], "#b8ad99", .32);
    panel(6, 8, [-6, 1, 0], "#98968a", .14);
  } else {
    panel(4.8, 3.4, [-3.4, 4.2, 5.2], "#fff2db", 4.2);
    panel(.85, 5.8, [4.4, 1.3, 2.5], "#edf3e8", 5.5);
    panel(3.8, 5.2, [-4.4, -1.8, 1.3], "#cbd6c2", .85);
    panel(1.1, 5.6, [-2.7, 2.1, -4], "#eadbc3", 2.8);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(studio, .035, .1, 40);
  panels.forEach(mesh => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); });
  generator.dispose(); return target;
}
function shadowTexture() {
  const size = 192, bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const radius = u * u + v * v;
    const feather = 1 - THREE.MathUtils.smoothstep(radius, .65, 1);
    const alpha = Math.exp(-radius * 4.5) * feather;
    const offset = (y * size + x) * 4;
    bytes[offset] = bytes[offset + 1] = bytes[offset + 2] = 0; bytes[offset + 3] = Math.round(alpha * 255);
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

function CardObject({ artwork, pose, visible, onReady, onLost, archive = false, onArchiveShadow }: SceneProps) {
  const group = useRef<THREE.Group>(null), softShadow = useRef<THREE.Mesh>(null);
  const archiveKey = useRef<THREE.PointLight>(null);
  const { gl, scene, camera, size, invalidate } = useThree();
  const cameraInitialized = useRef(false);
  const room = useRef<RoomRegistration | null>(null), shadowCallback = useRef(onArchiveShadow);
  const tableCalibration = useRef<{ revision: number; distance: number; value: ArchiveTableCalibration | null } | null>(null);
  const environmentRotation = useMemo(() => new THREE.Quaternion(), []);
  const started = useRef<number | null>(null), initial = useRef(true), didAnnounce = useRef(false), latest = useRef(pose);
  const surface = artwork as SurfaceArtwork;
  const textures = useMemo(() => {
    const create = (source: HTMLCanvasElement, color = false) => {
      const texture = new THREE.CanvasTexture(source);
      texture.anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), 8);
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      return texture;
    };
    const frontFoil = surface.frontFoilMask ? create(surface.frontFoilMask) : null;
    const backFoil = surface.backFoilMask === surface.frontFoilMask
      ? frontFoil : surface.backFoilMask ? create(surface.backFoilMask) : null;
    return {
      front: create(surface.front, true), back: create(surface.back, true),
      frontRoughness: create(surface.frontRoughness ?? surface.roughness), backRoughness: create(surface.backRoughness ?? surface.roughness),
      frontBump: create(surface.frontBump ?? surface.roughness), backBump: create(surface.backBump ?? surface.roughness),
      frontFoil, backFoil,
    };
  }, [surface, gl]);
  const geometry = useMemo(() => createMemberCardGeometry(surface.materialSeed), [surface.materialSeed]);
  const framing = useMemo(() => {
    const corners = cardBoundsCorners([geometry.stock, geometry.fibers]);
    return { corners, floorY: cardGroundHeight(corners) };
  }, [geometry]);
  const restDistance = useMemo(() => restingCardCameraDistance(framing.corners, size), [framing, size]);
  const shadow = useMemo(shadowTexture, []);
  const materials = useMemo(() => {
    const face = (back: boolean) => createCardFaceMaterial({
      color: back ? textures.back : textures.front,
      roughness: back ? textures.backRoughness : textures.frontRoughness,
      bump: back ? textures.backBump : textures.frontBump,
      foilMask: back ? textures.backFoil : textures.frontFoil,
    });
    return [face(false), face(true), new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: .96, metalness: 0, envMapIntensity: .45 })];
  }, [textures]);
  useEffect(() => {
    const environment = studioEnvironment(gl, archive), previous = scene.environment, previousIntensity = scene.environmentIntensity, previousRotation = scene.environmentRotation.clone();
    scene.environment = environment.texture; scene.environmentIntensity = archive ? .48 : .68; invalidate();
    return () => { scene.environment = previous; scene.environmentIntensity = previousIntensity; scene.environmentRotation.copy(previousRotation); environment.dispose(); };
  }, [gl, scene, invalidate, archive]);
  useEffect(() => { shadowCallback.current = onArchiveShadow; }, [onArchiveShadow]);
  useEffect(() => {
    if (!archive || !visible || pose.reduced) { shadowCallback.current?.(null); return; }
    let pending = 0;
    const measure = () => {
      pending = 0;
      const bounds = gl.domElement.getBoundingClientRect(), root = document.documentElement;
      const width = root.clientWidth || window.innerWidth, height = root.clientHeight || window.innerHeight;
      room.current = {
        layout: getArchiveLightLayout(width, height, window.matchMedia("(max-aspect-ratio: 4/5)").matches),
        rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
        revision: (room.current?.revision ?? 0) + 1,
      };
      invalidate();
    };
    const schedule = () => { if (!pending) pending = window.requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(gl.domElement); observer.observe(document.documentElement);
    const viewer = gl.domElement.closest("[data-member-card]");
    if (viewer) observer.observe(viewer);
    // Details, wrapping controls and a share status can move an unchanged canvas
    // inside the page's automatic margins. Observe those bounded layout siblings.
    const page = gl.domElement.closest("[data-public-member-card]");
    if (page) for (const child of page.children) observer.observe(child);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (pending) window.cancelAnimationFrame(pending);
      observer.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
      room.current = null; tableCalibration.current = null; shadowCallback.current?.(null);
    };
  }, [archive, visible, pose.reduced, gl, invalidate]);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => { event.preventDefault(); shadowCallback.current?.(null); onLost(); };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl, onLost]);
  useEffect(() => () => { new Set(Object.values(textures)).forEach(texture => texture?.dispose()); }, [textures]);
  useEffect(() => () => { materials.forEach(material => material.dispose()); }, [materials]);
  useEffect(() => () => { geometry.stock.dispose(); geometry.fibers.dispose(); }, [geometry]);
  useEffect(() => () => shadow.dispose(), [shadow]);
  useEffect(() => {
    if (latest.current.side !== pose.side || pose.lifted || latest.current.reset !== pose.reset) initial.current = false;
    latest.current = pose; invalidate();
  }, [pose, invalidate]);
  useEffect(() => {
    if (!visible) return;
    invalidate();
    if (pose.reduced) return;
    // A quiet 30 fps drift, paused off-screen and whenever the tab is hidden.
    const timer = window.setInterval(invalidate, 1000 / 30);
    return () => window.clearInterval(timer);
  }, [visible, pose.reduced, invalidate]);
  useEffect(() => { invalidate(); }, [artwork, invalidate]);
  useFrame((state, dt) => {
    const object = group.current; if (!object || !visible) return;
    if (started.current === null) started.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - started.current, target = latest.current;
    const intro = initial.current && !target.reduced && elapsed < 2.75;
    const t = Math.min(1, elapsed / 2.75), ease = 1 - Math.pow(1 - t, 3);
    const drift = !target.reduced && !target.lifted;
    const idleY = drift ? Math.sin(elapsed * .48) * .014 : 0;
    const idleTilt = drift ? Math.sin(elapsed * .31) * .012 : 0;
    const base = target.side === "front" ? 0 : Math.PI;
    const rx = target.reduced ? 0 : CARD_REST_ROTATION.x + target.tiltX + idleTilt;
    const rawYaw = base + (target.reduced ? 0 : REST_YAW + target.tiltY);
    const ry = intro ? REST_YAW - Math.PI * 2 * (1 - ease) : nearestAngle(object.rotation.y, rawYaw);
    const rz = target.reduced ? 0 : CARD_REST_ROTATION.z + target.roll + (drift ? Math.sin(elapsed * .25) * .006 : 0);
    const px = target.reduced ? 0 : target.x, py = target.reduced ? 0 : target.y + idleY;
    const pz = target.lifted ? .39 : .015;
    const speed = target.reduced ? 1 : 1 - Math.exp(-Math.min(dt, .05) * (target.lifted ? 18 : 9));
    object.rotation.x = THREE.MathUtils.lerp(object.rotation.x, rx, speed);
    object.rotation.y = intro ? ry : THREE.MathUtils.lerp(object.rotation.y, ry, speed);
    object.rotation.z = THREE.MathUtils.lerp(object.rotation.z, rz, speed);
    object.position.x = THREE.MathUtils.lerp(object.position.x, px, speed);
    object.position.y = THREE.MathUtils.lerp(object.position.y, py, speed);
    object.position.z = THREE.MathUtils.lerp(object.position.z, pz, speed);
    // Fit after interpolation: mid-flip corners and lifted perspective can be
    // wider than either resting face. CSS overflow cannot extend this frustum.
    object.updateWorldMatrix(true, false);
    let cameraMoving = false;
    if (camera instanceof THREE.PerspectiveCamera) {
      const required = requiredCardCameraDistance(framing.corners, object.matrixWorld, size, camera.fov);
      const distance = nextCardCameraDistance(camera.position.z, required, restDistance, dt, cameraInitialized.current);
      cameraMoving = Math.abs(camera.position.z - distance) > .0001;
      camera.position.set(0, CARD_CAMERA.y, distance);
      camera.rotation.set(0, 0, 0);
      camera.updateMatrixWorld();
      cameraInitialized.current = true;
    }
    if (archive && camera instanceof THREE.PerspectiveCamera) {
      const registration = room.current;
      const lamp = registration ? archiveLampPosition(registration.layout, registration.rect, camera, -framing.floorY + .8) : null;
      if (lamp && registration) {
        if (archiveKey.current) { archiveKey.current.position.copy(lamp); archiveKey.current.intensity = lamp.lengthSq() * 1.8; }
        environmentRotation.setFromUnitVectors(ARCHIVE_ENV_SOURCE, lamp.clone().normalize());
        scene.environmentRotation.setFromQuaternion(environmentRotation);
        if (tableCalibration.current?.revision !== registration.revision || tableCalibration.current.distance !== restDistance) {
          const restingCamera = camera.clone(); restingCamera.position.z = restDistance; restingCamera.updateMatrixWorld();
          const restingLamp = archiveLampPosition(registration.layout, registration.rect, restingCamera, -framing.floorY + .8);
          const restingMatrix = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, .015), new THREE.Quaternion().setFromEuler(new THREE.Euler(CARD_REST_ROTATION.x, CARD_REST_ROTATION.y, CARD_REST_ROTATION.z)), new THREE.Vector3(1, 1, 1));
          tableCalibration.current = {
            revision: registration.revision, distance: restDistance,
            value: restingLamp ? createArchiveTableCalibration(framing.corners, restingMatrix, restingLamp, registration.rect, registration.layout, framing.floorY) : null,
          };
        }
        const calibration = tableCalibration.current.value;
        shadowCallback.current?.(calibration && !target.reduced ? projectArchiveShadow(framing.corners, object.matrixWorld, lamp, calibration, registration.layout) : null);
      } else { if (archiveKey.current) archiveKey.current.intensity = 0; shadowCallback.current?.(null); }
    }
    if (softShadow.current) {
      // The shadow stays on a horizontal floor, separate from the card's tilt.
      const elevation = Math.max(0, object.position.y + .25);
      softShadow.current.position.set(object.position.x * .75 + .04, framing.floorY, -.65 + object.position.z * .6);
      softShadow.current.scale.set(1 + elevation * .3, 1 + elevation * .4, 1);
      (softShadow.current.material as THREE.MeshBasicMaterial).opacity = .18 / (1 + elevation);
    }
    const moving = Math.abs(object.rotation.x - rx) + Math.abs(object.rotation.y - ry) + Math.abs(object.rotation.z - rz) + Math.abs(object.position.x - px) + Math.abs(object.position.y - py) + Math.abs(object.position.z - pz) > .0015;
    if (intro || target.lifted || moving || cameraMoving) invalidate();
  });
  return <>
    {archive ? <>
      <ambientLight intensity={.16} color="#c8bcaa" />
      <pointLight ref={archiveKey} intensity={0} color="#ffe4bb" decay={2} />
      {/* Broad viewer-side fill opens the ink without changing the pendant or its shadow. */}
      <directionalLight position={[.8, .4, 6]} intensity={1.7} color="#d5cdbf" />
      <directionalLight position={[-1, -3, 2]} intensity={.48} color="#ba9465" />
    </> : <>
      <ambientLight intensity={.42} />
      <directionalLight position={[-3.8, 5.2, 6]} intensity={2.55} color="#fff1d8" />
      <directionalLight position={[4, .5, 2]} intensity={1.35} color="#e0e9dc" />
      <directionalLight position={[-2, 3, -4]} intensity={1.85} color="#ecdbc0" />
    </>}
    <group ref={group} visible={visible}>
      <mesh geometry={geometry.stock} material={materials} onAfterRender={() => {
        if (!didAnnounce.current) { didAnnounce.current = true; queueMicrotask(onReady); }
      }} />
      <mesh geometry={geometry.fibers}><meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={1} metalness={0} /></mesh>
    </group>
    {!archive && <mesh ref={softShadow} visible={visible} position={[.04, framing.floorY, -.65]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.9, 1.65]} /><meshBasicMaterial map={shadow} transparent opacity={.14} depthWrite={false} depthTest={true} toneMapped={false} /></mesh>}
  </>;
}

export default function MemberCardScene({ artwork, pose, visible, onReady, onLost, archive = false, onArchiveShadow }: SceneProps) {
  return <Canvas frameloop="demand" dpr={[1, 1.65]} camera={{ position: [0, CARD_CAMERA.y, 8.1], fov: CARD_CAMERA.fov, near: CARD_CAMERA.near, far: CARD_CAMERA.far }}
    gl={(defaults) => {
      try {
        const renderer = new THREE.WebGLRenderer({ ...defaults, alpha: true, antialias: true, powerPreference: "low-power" });
        renderer.setClearColor(0x000000, 0); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
        return renderer;
      } catch (error) { queueMicrotask(() => { onArchiveShadow?.(null); onLost(); }); throw error; }
    }}
    fallback={<span />}>
    <CardObject artwork={artwork} pose={pose} visible={visible} onReady={onReady} onLost={onLost} archive={archive} onArchiveShadow={onArchiveShadow} />
  </Canvas>;
}
