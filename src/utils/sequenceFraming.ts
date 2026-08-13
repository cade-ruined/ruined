import {
  SEQUENCE_CENTER_FOCAL_X,
  SEQUENCE_LOBBY_FOCAL_X,
  sequenceFrameCount,
} from "@/data/sequences";

const FRAME_PATH_PATTERN =
  /\/sequences\/(mobile\/)?([^/]+)\/frame-(\d+)\.webp/;
const MIN_FOCAL = 0.01;
const MAX_FOCAL = 0.99;

function clampFocal(focal: number) {
  return Math.min(MAX_FOCAL, Math.max(MIN_FOCAL, focal));
}

function mix(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

/**
 * The lobby render's architectural axis (and the RUINED sign) sits slightly
 * right of the file midpoint. Keep that axis fixed through the lobby, then
 * release it gradually during the store walk so later, centered rooms are not
 * needlessly shifted and both room handoffs remain identical.
 */
export function sequenceFrameFocalX(roomId: string, frameNumber: number) {
  if (roomId === "lobby") return SEQUENCE_LOBBY_FOCAL_X;

  if (roomId === "store") {
    const lastFrame = Math.max(1, sequenceFrameCount(roomId) - 1);
    const progress = Math.min(1, Math.max(0, (frameNumber - 1) / lastFrame));
    return mix(SEQUENCE_LOBBY_FOCAL_X, SEQUENCE_CENTER_FOCAL_X, progress);
  }

  return SEQUENCE_CENTER_FOCAL_X;
}

export function sequenceAssetFocalX(asset: string) {
  const match = asset.match(FRAME_PATH_PATTERN);
  if (!match) return SEQUENCE_CENTER_FOCAL_X;
  // Mobile frames have already been cropped around the room focal point, so
  // their new portrait canvas is centered. Desktop endpoints retain the
  // source-space focal calculation for an identical visual handoff.
  if (match[1]) return SEQUENCE_CENTER_FOCAL_X;
  return sequenceFrameFocalX(match[2], Number(match[3]));
}

/**
 * Returns the smallest cover rectangle that places the requested source focal
 * point at the exact center of the destination without exposing empty edges.
 */
export function sequenceCoverRect(
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
  focalX: number
) {
  const safeFocalX = clampFocal(focalX);
  const horizontalCoverage = 2 * Math.min(safeFocalX, 1 - safeFocalX);
  const scale = Math.max(
    destinationWidth / (sourceWidth * horizontalCoverage),
    destinationHeight / sourceHeight
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: destinationWidth / 2 - safeFocalX * width,
    y: (destinationHeight - height) / 2,
    width,
    height,
  };
}

/**
 * CSS equivalent of sequenceCoverRect. The oversized box plus matching
 * object/background position reproduces the canvas crop at every aspect ratio.
 */
export function sequenceFocalBoxGeometry(focalX: number) {
  const safeFocalX = clampFocal(focalX);
  const width = 100 / (2 * Math.min(safeFocalX, 1 - safeFocalX));

  return {
    position: "absolute" as const,
    right: "auto",
    bottom: "auto",
    left: "50%",
    top: "50%",
    width: `${width}%`,
    height: "100%",
    transform: `translate(-${safeFocalX * 100}%, -50%)`,
  };
}

export function sequenceFocalMediaStyle(focalX: number) {
  const safeFocalX = clampFocal(focalX);
  return {
    ...sequenceFocalBoxGeometry(safeFocalX),
    maxWidth: "none",
    objectFit: "cover" as const,
    objectPosition: `${safeFocalX * 100}% center`,
  };
}
