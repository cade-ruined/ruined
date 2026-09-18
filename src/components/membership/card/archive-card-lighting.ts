import * as THREE from "three";
import type { ArchiveLightLayout, ArchivePoint, ArchiveShadow } from "./archive-lighting";

export type ArchiveStageRect = { left: number; top: number; width: number; height: number };
export type ArchiveTableCalibration = {
  floorY: number; originX: number; originZ: number; anchor: ArchivePoint;
  scaleX: number; scaleZ: number; perspective: number; blur: number;
};

/** Register a simulated source on the photograph, safely above the entire card envelope. */
export function archiveLampPosition(layout: ArchiveLightLayout, rect: ArchiveStageRect, camera: THREE.PerspectiveCamera, minimumY: number): THREE.Vector3 | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const ray = new THREE.Vector3((layout.pendant.x - rect.left) / rect.width * 2 - 1, 1 - (layout.pendant.y - rect.top) / rect.height * 2, .5)
    .unproject(camera).sub(camera.position).normalize();
  // A scrolled-past canvas can put the pictured lamp below its optical horizon.
  // There is then no forward ray with an overhead source; hide the approximation.
  if (ray.y <= .025) return null;
  const distance = (minimumY - camera.position.y) / ray.y;
  if (!Number.isFinite(distance) || distance <= 0 || distance > 100) return null;
  return ray.multiplyScalar(distance).add(camera.position);
}

/** Project each transformed corner away from the same lamp onto a horizontal table. */
export function archiveFloorFootprint(corners: readonly THREE.Vector3[], matrix: THREE.Matrix4, lamp: THREE.Vector3, floorY: number): THREE.Vector3[] | null {
  const result: THREE.Vector3[] = [];
  for (const corner of corners) {
    const point = corner.clone().applyMatrix4(matrix);
    const separation = lamp.y - point.y;
    if (separation < .08 || point.y <= floorY) return null;
    const extension = (point.y - floorY) / separation;
    point.addScaledVector(point.clone().sub(lamp), extension);
    point.y = floorY;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
    result.push(point);
  }
  return result;
}

/**
 * The photograph is not a reconstructed room. Calibrate the resting floor
 * footprint into its foreshortened tabletop once per viewport/camera setup.
 * Later frames retain their physical footprint changes instead of recentering.
 */
export function createArchiveTableCalibration(
  corners: readonly THREE.Vector3[], restingMatrix: THREE.Matrix4, lamp: THREE.Vector3,
  rect: ArchiveStageRect, layout: ArchiveLightLayout, floorY: number,
): ArchiveTableCalibration | null {
  const points = archiveFloorFootprint(corners, restingMatrix, lamp, floorY);
  const depth = layout.table.frontY - layout.table.backY;
  if (!points || depth <= 1) return null;
  const bounds = new THREE.Box3().setFromPoints(points), extent = bounds.getSize(new THREE.Vector3());
  if (extent.x < .01 || extent.z < .01) return null;
  const center = bounds.getCenter(new THREE.Vector3());
  const stageCenter = rect.left + rect.width / 2;
  return {
    floorY, originX: center.x, originZ: center.z,
    anchor: { x: stageCenter + (stageCenter - layout.pendant.x) * .16, y: layout.table.pool.y },
    scaleX: Math.min(rect.width * .65, layout.width * .43) / extent.x,
    scaleZ: depth * .43 / extent.z,
    perspective: .045 / Math.max(extent.z, 1),
    blur: THREE.MathUtils.clamp(depth * .075, 8, 24),
  };
}

function convexHull(points: ArchivePoint[]): ArchivePoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: ArchivePoint, b: ArchivePoint, c: ArchivePoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (items: ArchivePoint[]) => {
    const hull: ArchivePoint[] = [];
    for (const point of items) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull;
  };
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}

export function projectArchiveShadow(
  corners: readonly THREE.Vector3[], matrix: THREE.Matrix4, lamp: THREE.Vector3,
  calibration: ArchiveTableCalibration, layout: ArchiveLightLayout,
): ArchiveShadow | null {
  const footprint = archiveFloorFootprint(corners, matrix, lamp, calibration.floorY);
  if (!footprint || layout.table.frontY <= 0 || layout.table.backY >= layout.height) return null;
  const points: ArchivePoint[] = [];
  for (const point of footprint) {
    const x = point.x - calibration.originX, z = point.z - calibration.originZ;
    const denominator = 1 - z * calibration.perspective;
    if (denominator < .3) return null;
    const projected = { x: calibration.anchor.x + x * calibration.scaleX / denominator, y: calibration.anchor.y + z * calibration.scaleZ / denominator };
    // Skip a degenerate registration instead of stretching a giant dark polygon.
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || Math.abs(projected.x) > layout.width * 4 || Math.abs(projected.y) > layout.height * 4) return null;
    points.push(projected);
  }
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  const separation = Math.max(0, position.y) + Math.max(0, position.z - .015) * .5;
  return {
    points: hull, opacity: .14 / (1 + separation * .35), blur: calibration.blur * (1 + separation * .15),
    clipTop: layout.table.backY, clipBottom: layout.table.frontY, width: layout.width, height: layout.height,
  };
}
