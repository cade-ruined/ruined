import * as THREE from "three";

export const CARD_CAMERA = { fov: 31, y: .03, near: .1, far: 60 } as const;
export const CARD_REST_ROTATION = { x: .075, y: -.245, z: -.067 } as const;
export type CardViewport = { width: number; height: number };
export type CardFrameLimits = { left: number; right: number; bottom: number; top: number };

/** Reserve actual canvas pixels for corners, paper fibers, and the bottom hint. */
export function cardFrameLimits(viewport: CardViewport): CardFrameLimits {
  const width = Math.max(1, viewport.width), height = Math.max(1, viewport.height);
  const sideInset = Math.min(width * .14, Math.max(14, Math.min(26, width * .045)));
  const topInset = Math.min(20, height * .12), bottomInset = Math.min(34, height * .16);
  return {
    left: -1 + sideInset * 2 / width, right: 1 - sideInset * 2 / width,
    bottom: -1 + bottomInset * 2 / height, top: 1 - topInset * 2 / height,
  };
}

/** Bounds include the real warped stock and every detached edge-fiber tip. */
export function cardBoundsCorners(geometries: readonly THREE.BufferGeometry[]): THREE.Vector3[] {
  const bounds = new THREE.Box3();
  for (const geometry of geometries) { geometry.computeBoundingBox(); if (geometry.boundingBox) bounds.union(geometry.boundingBox); }
  if (bounds.isEmpty()) throw new Error("A member card needs finite geometry bounds.");
  return [bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.y, bounds.max.y].flatMap(y => [bounds.min.z, bounds.max.z].map(z => new THREE.Vector3(x, y, z))));
}

/**
 * Solve the perspective frustum inequalities for camera Z after the object's
 * actual interpolated transform. Every enclosed vertex is safe if these eight
 * transformed corners are inside the four linear frustum planes.
 */
export function requiredCardCameraDistance(
  corners: readonly THREE.Vector3[], transform: THREE.Matrix4, viewport: CardViewport,
  fov: number = CARD_CAMERA.fov, cameraY: number = CARD_CAMERA.y,
): number {
  const aspect = Math.max(1, viewport.width) / Math.max(1, viewport.height);
  const tangentY = Math.tan(THREE.MathUtils.degToRad(fov) / 2), tangentX = tangentY * aspect;
  const limits = cardFrameLimits(viewport), point = new THREE.Vector3();
  let distance = CARD_CAMERA.near * 3;
  for (const corner of corners) {
    point.copy(corner).applyMatrix4(transform);
    const horizontal = point.x / (tangentX * (point.x < 0 ? limits.left : limits.right));
    const y = point.y - cameraY;
    const vertical = y / (tangentY * (y < 0 ? limits.bottom : limits.top));
    distance = Math.max(distance, point.z + horizontal, point.z + vertical, point.z + CARD_CAMERA.near * 3);
  }
  return distance + .012;
}

export function restingCardCameraDistance(corners: readonly THREE.Vector3[], viewport: CardViewport): number {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(CARD_REST_ROTATION.x, CARD_REST_ROTATION.y, CARD_REST_ROTATION.z));
  const transform = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, .015), rotation, new THREE.Vector3(1, 1, 1));
  // Keep a little breathing room at rest, without shrinking a narrow card panel
  // to the bounding sphere of every possible future drag rotation.
  return requiredCardCameraDistance(corners, transform, viewport) * 1.045;
}

/** Retreat immediately to avoid a clipped frame; only the return may ease. */
export function nextCardCameraDistance(current: number, required: number, resting: number, delta: number, initialized = true): number {
  const target = Math.max(required, resting);
  if (!initialized || target >= current) return target;
  return Math.max(required, THREE.MathUtils.lerp(current, target, 1 - Math.exp(-Math.min(delta, .05) * 7)));
}

/** A decorative floor must sit below the complete rotation/translation envelope. */
export function cardGroundHeight(corners: readonly THREE.Vector3[]): number {
  const radius = Math.max(...corners.map(corner => corner.length()));
  return -radius - .334 - .14;
}
