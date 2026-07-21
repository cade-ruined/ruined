import * as THREE from "three";
import { useMemo } from "react";
import { useTexture } from "@react-three/drei";
import { PALETTE } from "./config";
import { useSurfaceMaterial, tilesFor, type SurfaceKey } from "./materials";

type Vec3 = [number, number, number];

// A single solid. Give it a `surface` for a tiled PBR material, or a `color`
// for a plain matte/emissive prop. `repeat` sets texture tiling (u, v).
export function Box({
  position,
  size,
  color = "#888888",
  surface,
  repeat,
  roughness = 0.92,
  metalness = 0,
  emissive,
  emissiveIntensity = 0,
}: {
  position: Vec3;
  size: Vec3;
  color?: string;
  surface?: SurfaceKey;
  repeat?: [number, number];
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}) {
  const mat = useSurfaceMaterial(surface, repeat?.[0] ?? 1, repeat?.[1] ?? 1);
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      {mat ? (
        <primitive object={mat} attach="material" />
      ) : (
        <meshStandardMaterial
          color={color}
          roughness={roughness}
          metalness={metalness}
          emissive={emissive ?? "#000000"}
          emissiveIntensity={emissiveIntensity}
        />
      )}
    </mesh>
  );
}

// A horizontal slab (floor or ceiling) spanning a Z range.
export function Slab({
  y,
  z0,
  z1,
  halfX,
  surface,
}: {
  y: number;
  z0: number;
  z1: number;
  halfX: number;
  surface: SurfaceKey;
}) {
  const depth = Math.abs(z1 - z0);
  const cz = (z0 + z1) / 2;
  return (
    <Box
      position={[0, y, cz]}
      size={[halfX * 2, 0.2, depth]}
      surface={surface}
      repeat={tilesFor(surface, halfX * 2, depth)}
    />
  );
}

// A flat wall segment on a side (x = ±halfX), spanning a Z range, from y0 up.
export function SideWall({
  side,
  halfX,
  z0,
  z1,
  y0,
  height,
  thickness,
  surface = "concrete",
}: {
  side: 1 | -1;
  halfX: number;
  z0: number;
  z1: number;
  y0: number;
  height: number;
  thickness: number;
  surface?: SurfaceKey;
}) {
  const depth = Math.abs(z1 - z0);
  return (
    <Box
      position={[side * halfX, y0 + height / 2, (z0 + z1) / 2]}
      size={[thickness, height, depth]}
      surface={surface}
      repeat={tilesFor(surface, depth, height)}
    />
  );
}

// A cross wall (facing the camera) with a centred doorway cut out of it —
// rendered as two jambs + a lintel so the black opening reads as a real portal.
export function DoorWall({
  z,
  halfX,
  y0,
  height,
  thickness,
  door,
  surface = "concrete",
  frame = true,
}: {
  z: number;
  halfX: number;
  y0: number;
  height: number;
  thickness: number;
  door: { w: number; h: number };
  surface?: SurfaceKey;
  frame?: boolean;
}) {
  const jambW = halfX - door.w / 2;
  const jambCx = door.w / 2 + jambW / 2;
  const lintelH = height - door.h;
  return (
    <group>
      <Box
        position={[-jambCx, y0 + height / 2, z]}
        size={[jambW, height, thickness]}
        surface={surface}
        repeat={tilesFor(surface, jambW, height)}
      />
      <Box
        position={[jambCx, y0 + height / 2, z]}
        size={[jambW, height, thickness]}
        surface={surface}
        repeat={tilesFor(surface, jambW, height)}
      />
      <Box
        position={[0, y0 + door.h + lintelH / 2, z]}
        size={[door.w, lintelH, thickness]}
        surface={surface}
        repeat={tilesFor(surface, door.w, lintelH)}
      />
      {frame && (
        <group>
          <Box
            position={[-door.w / 2, y0 + door.h / 2, z]}
            size={[0.14, door.h, thickness + 0.1]}
            surface="steel"
          />
          <Box
            position={[door.w / 2, y0 + door.h / 2, z]}
            size={[0.14, door.h, thickness + 0.1]}
            surface="steel"
          />
          <Box
            position={[0, y0 + door.h, z]}
            size={[door.w + 0.14, 0.14, thickness + 0.1]}
            surface="steel"
          />
        </group>
      )}
    </group>
  );
}

// The image panel inside a frame — a real Ruined piece, lit slightly emissive
// so it reads even in the dim rooms. Split out so the texture hook only mounts
// when there is art to load.
function ArtImage({ art, w, h }: { art: string; w: number; h: number }) {
  const tex = useTexture(art);
  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, [tex]);
  return (
    <mesh position={[0, 0, 0.05]}>
      <planeGeometry args={[w - 0.16, h - 0.16]} />
      <meshStandardMaterial
        map={tex}
        emissiveMap={tex}
        emissive="#ffffff"
        emissiveIntensity={0.28}
        roughness={0.9}
        metalness={0}
      />
    </mesh>
  );
}

// Framed artwork on a side wall. Pass `art` (a texture URL) to hang a real
// piece; otherwise it renders a blank canvas placeholder.
export function ArtFrame({
  side,
  halfX,
  y,
  z,
  w = 1.4,
  h = 2,
  art,
}: {
  side: 1 | -1;
  halfX: number;
  y: number;
  z: number;
  w?: number;
  h?: number;
  art?: string;
}) {
  const x = side * (halfX - 0.18);
  return (
    <group position={[x, y, z]} rotation={[0, side === 1 ? -Math.PI / 2 : Math.PI / 2, 0]}>
      <Box position={[0, 0, 0]} size={[w, h, 0.07]} surface="steel" />
      {art ? (
        <ArtImage art={art} w={w} h={h} />
      ) : (
        <Box position={[0, 0, 0.045]} size={[w - 0.16, h - 0.16, 0.02]} color={PALETTE.canvas} roughness={0.95} />
      )}
    </group>
  );
}

// A clothing rail with a block of hanging garments.
export function Rack({
  position,
  length = 2.4,
}: {
  position: Vec3;
  length?: number;
}) {
  return (
    <group position={position}>
      <Box position={[0, 1.5, 0]} size={[length, 0.05, 0.05]} surface="steel" />
      <Box position={[-length / 2, 0.75, 0]} size={[0.05, 1.5, 0.05]} surface="steel" />
      <Box position={[length / 2, 0.75, 0]} size={[0.05, 1.5, 0.05]} surface="steel" />
      <Box position={[0, 1.05, 0]} size={[length - 0.2, 0.8, 0.5]} color={PALETTE.concreteDark} roughness={1} />
    </group>
  );
}

// A leather bench on a blackened-steel base.
export function Bench({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <Box position={[0, 0.45, 0]} size={[1.8, 0.22, 0.6]} surface="leather" repeat={[1.6, 0.5]} />
      <Box position={[0, 0.2, 0]} size={[1.7, 0.28, 0.5]} surface="steel" />
    </group>
  );
}

// A hanging pendant lamp with a warm practical light.
export function Pendant({
  position,
  intensity = 6,
  distance = 8,
}: {
  position: Vec3;
  intensity?: number;
  distance?: number;
}) {
  return (
    <group position={position}>
      <Box position={[0, 0, 0]} size={[0.04, 0.6, 0.04]} surface="steel" />
      <mesh position={[0, -0.42, 0]}>
        <coneGeometry args={[0.28, 0.3, 20, 1, true]} />
        <meshStandardMaterial color={PALETTE.steel} side={THREE.DoubleSide} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, -0.5, 0]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color={PALETTE.glowWarm} emissive={PALETTE.glowWarm} emissiveIntensity={3} />
      </mesh>
      <pointLight position={[0, -0.5, 0]} intensity={intensity} distance={distance} decay={2} color={PALETTE.glowWarm} />
    </group>
  );
}
