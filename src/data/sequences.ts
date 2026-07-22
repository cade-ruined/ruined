import { SEQUENCE_CACHE_VERSION } from "@/data/sequence-version";

// The rooms of the homepage dive, in scroll order. Each has a frame sequence
// under public/sequences/<id>/ (see public/sequences/README.md). `sceneSrc` is
// the single-image fallback used until a sequence is uploaded / built.
export type RoomSequence = {
  id: string;
  label: string;
  sceneSrc: string;
};

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
  "/sequences/lobby/frame-0001.webp"
);

export const SEQUENCE_ROOMS: RoomSequence[] = [
  { id: "lobby", label: "Lobby", sceneSrc: "/ruined-hero-1.jpg" },
  { id: "store", label: "Store", sceneSrc: "/ruined-hero-store-4.jpg" },
  { id: "records", label: "Records", sceneSrc: "/ruined-hero-records.jpg" },
  { id: "lounge", label: "Lounge", sceneSrc: "/ruined-hero-lounge.jpg" },
];

// Shape of public/sequences/manifest.json, produced by scripts/build-sequences.mjs.
export type SequenceManifest = {
  version: string;
  rooms: { id: string; count: number; files: string[] }[];
  total: number;
};
