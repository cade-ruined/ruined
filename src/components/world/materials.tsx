import { createContext, useContext, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";

// The seamless texture set: albedo + a derived tangent-space normal map for
// each surface (see scripts/gen-normals.mjs). Loaded once, shared everywhere;
// per-surface materials clone the base textures so they can tile at real-world
// density without duplicating GPU uploads.
const FILES = {
  concrete: "/textures/concrete.jpg",
  brick: "/textures/brick.jpg",
  floor: "/textures/floor.jpg",
  wood: "/textures/wood.jpg",
  leather: "/textures/leather.jpg",
  steel: "/textures/steel.jpg",
  plaster: "/textures/plaster.jpg",
} as const;

const NFILES = {
  concrete: "/textures/concrete_n.png",
  brick: "/textures/brick_n.png",
  floor: "/textures/floor_n.png",
  wood: "/textures/wood_n.png",
  leather: "/textures/leather_n.png",
  steel: "/textures/steel_n.png",
  plaster: "/textures/plaster_n.png",
} as const;

type FileKey = keyof typeof FILES;

// Named surfaces used throughout the building. `tile` = metres covered by one
// texture repeat (keeps texel density consistent across differently-sized
// walls). `color` tints the albedo (white = untouched). `normal` = normalScale.
export const SURFACES = {
  concrete: { file: "concrete", color: "#ffffff", rough: 0.96, metal: 0, tile: 2.8, normal: 0.7 },
  concreteDark: { file: "concrete", color: "#9b948a", rough: 0.96, metal: 0, tile: 2.8, normal: 0.7 },
  brick: { file: "brick", color: "#ffffff", rough: 1.0, metal: 0, tile: 1.8, normal: 1.1 },
  floor: { file: "floor", color: "#efe9df", rough: 0.32, metal: 0, tile: 3.4, normal: 0.35 },
  floorLower: { file: "floor", color: "#a8a299", rough: 0.4, metal: 0, tile: 3.4, normal: 0.35 },
  plaster: { file: "plaster", color: "#ffffff", rough: 0.95, metal: 0, tile: 3.2, normal: 0.5 },
  wood: { file: "wood", color: "#ffffff", rough: 0.85, metal: 0, tile: 1.8, normal: 0.9 },
  leather: { file: "leather", color: "#ffffff", rough: 0.5, metal: 0, tile: 1.2, normal: 0.7 },
  steel: { file: "steel", color: "#ffffff", rough: 0.48, metal: 0.35, tile: 1.4, normal: 0.4 },
} as const;

export type SurfaceKey = keyof typeof SURFACES;

type Bases = { albedo: Record<FileKey, THREE.Texture>; normal: Record<FileKey, THREE.Texture> };
const Ctx = createContext<Bases | null>(null);

export function MaterialsProvider({ children }: { children: ReactNode }) {
  const albedo = useTexture(FILES as unknown as Record<string, string>) as unknown as Record<FileKey, THREE.Texture>;
  const normal = useTexture(NFILES as unknown as Record<string, string>) as unknown as Record<FileKey, THREE.Texture>;

  const bases = useMemo<Bases>(() => {
    (Object.keys(albedo) as FileKey[]).forEach((k) => {
      const t = albedo[k];
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
    });
    (Object.keys(normal) as FileKey[]).forEach((k) => {
      const t = normal[k];
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.NoColorSpace; // normals are linear data, not colour
      t.anisotropy = 8;
    });
    return { albedo, normal };
  }, [albedo, normal]);

  return <Ctx.Provider value={bases}>{children}</Ctx.Provider>;
}

// Build a material for a surface, tiled ru×rv. Memoized per (key, repeat).
export function useSurfaceMaterial(
  key: SurfaceKey | undefined,
  ru = 1,
  rv = 1
): THREE.MeshStandardMaterial | null {
  const bases = useContext(Ctx);
  return useMemo(() => {
    if (!key || !bases) return null;
    const cfg = SURFACES[key];
    const file = cfg.file as FileKey;
    const map = bases.albedo[file]?.clone();
    const nrm = bases.normal[file]?.clone();
    if (!map) return null;
    map.repeat.set(Math.max(0.1, ru), Math.max(0.1, rv));
    map.needsUpdate = true;
    if (nrm) {
      nrm.repeat.set(Math.max(0.1, ru), Math.max(0.1, rv));
      nrm.needsUpdate = true;
    }
    return new THREE.MeshStandardMaterial({
      map,
      normalMap: nrm ?? undefined,
      normalScale: new THREE.Vector2(cfg.normal, cfg.normal),
      color: new THREE.Color(cfg.color),
      roughness: cfg.rough,
      metalness: cfg.metal,
    });
  }, [key, ru, rv, bases]);
}

// Repeat counts for a surface across a w×h (metres) face.
export function tilesFor(key: SurfaceKey, w: number, h: number): [number, number] {
  const t = SURFACES[key].tile;
  return [w / t, h / t];
}
