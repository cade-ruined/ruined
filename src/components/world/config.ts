// Shared dimensions + material palette for the Ruined building. One connected
// world laid out along -Z: an upper floor (lobby → store) that descends a
// staircase to a lower floor (archive → gallery → exit).

export const DIMS = {
  hallHalf: 4.6, // walls at x = ±hallHalf
  ceilingUpper: 3.6, // upper-floor ceiling height (floor at y = 0)
  lowerFloorY: -4.6, // lower-floor slab height
  ceilingLower: 3.2,
  eye: 1.62, // camera eye height above whichever floor
  door: { w: 2.5, h: 2.9 }, // standard doorway opening
  wallT: 0.3, // wall thickness
};

// Muted, expensive, physically-plausible surfaces. Colors are sRGB; roughness
// high (matte) unless intentionally not.
export const PALETTE = {
  concrete: "#b0a99d",
  concreteDark: "#8b8378",
  plaster: "#c7c0b3",
  floor: "#6b655c",
  floorLower: "#5c574f",
  steel: "#151515",
  steelSoft: "#2a2a2a",
  wood: "#6a4d33",
  leather: "#a26c42",
  brick: "#7b5949",
  canvas: "#c9beac",
  glowWarm: "#ffcf8a",
  daylight: "#f2ecdf",
} as const;
