import { SEQUENCE_CACHE_VERSION } from "@/data/sequence-version";
import sequenceConfig from "@/data/sequence-config.json";

// The rooms of the homepage dive, in scroll order. Each has a frame sequence
// under public/sequences/<id>/ (see public/sequences/README.md).
export type RoomSequence = {
  id: string;
  label: string;
  frameCount: number;
};

export const SEQUENCE_CENTER_FOCAL_X = 0.5;
// Measured from the RUINED letterforms in the 1600px-wide lobby render.
export const SEQUENCE_LOBBY_FOCAL_X = 847.5 / 1600;

export const SEQUENCE_ROOMS: RoomSequence[] = sequenceConfig.rooms.map(
  (room) => ({ ...room })
);

export function sequenceFramePath(roomId: string, frameNumber: number) {
  return `/sequences/${roomId}/frame-${String(frameNumber).padStart(4, "0")}.webp`;
}

export function sequenceFrameCount(roomId: string) {
  const room = SEQUENCE_ROOMS.find((candidate) => candidate.id === roomId);
  if (!room) throw new Error(`Unknown sequence room: ${roomId}`);
  return room.frameCount;
}

// The desktop homepage must boot from the same asset the canvas paints first.
// Keeping this in the sequence namespace prevents a still from another shoot
// or camera position flashing before the lobby walk begins.
export function versionSequenceAsset(
  asset: string,
  version: string = SEQUENCE_CACHE_VERSION
) {
  const separator = asset.includes("?") ? "&" : "?";
  return `${asset}${separator}v=${version}`;
}

export { SEQUENCE_CACHE_VERSION };

export const SEQUENCE_OPENING_FRAME = versionSequenceAsset(
  sequenceFramePath("lobby", 1)
);

// Shape of public/sequences/manifest.json, produced by scripts/build-sequences.mjs.
export type SequenceManifest = {
  version: string;
  rooms: { id: string; count: number; files: string[] }[];
  total: number;
};
