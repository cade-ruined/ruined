import * as THREE from "three";
import { DIMS } from "@/components/world/config";

const upperEye = DIMS.eye; // 1.62
const lowerEye = DIMS.lowerFloorY + DIMS.eye; // ~ -2.98

// The dolly rail. A single Catmull-Rom spline the camera rides from the lobby,
// through the store doorway, down the staircase to the lower floor, and out
// through the archive + gallery. Kept centred on x≈0 so the vanishing point
// stays locked; the only real vertical move is the stair descent.
export const CAMERA_PATH = new THREE.CatmullRomCurve3(
  [
    [0, upperEye, 4], // arrival — standing in the lobby
    [0, upperEye, -1], // lobby
    [0, upperEye, -8.4], // through the doorway
    [0, upperEye, -14], // store
    [0, upperEye, -19.5], // approaching the stair
    [0, upperEye - 0.5, -22], // stepping off
    [0, (upperEye + lowerEye) / 2, -24], // mid-descent
    [0, lowerEye, -26.6], // lower landing
    [0, lowerEye, -32], // archive
    [0, lowerEye, -40], // gallery
    [0, lowerEye, -47], // toward the exit
  ].map((p) => new THREE.Vector3(p[0], p[1], p[2])),
  false,
  "catmullrom",
  0.5
);

// Room labels keyed to normalized progress, for the quiet wayfinding UI.
export const CHAPTERS: { at: number; label: string }[] = [
  { at: 0.0, label: "Lobby" },
  { at: 0.16, label: "Store" },
  { at: 0.42, label: "Descent" },
  { at: 0.55, label: "Archive" },
  { at: 0.78, label: "Gallery" },
  { at: 0.97, label: "Exit" },
];
