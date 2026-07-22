export const MOBILE_WALK_ROOMS = [
  "lobby",
  "store",
  "records",
  "lounge",
] as const;

export const MOBILE_SCENE_IDS = [
  "top",
  "store",
  "work",
  "about",
  "events",
] as const;

export type MobileSceneId = (typeof MOBILE_SCENE_IDS)[number];

export function mobileSceneIndexFromHash(hash: string) {
  const id = hash.replace(/^#/, "") || "top";
  const index = MOBILE_SCENE_IDS.indexOf(id as MobileSceneId);
  return index < 0 ? 0 : index;
}

// Each snapped section owns the opening frame of its sequence. The transition
// before it ends on this same asset, so revealing the card cannot change the
// image underneath the interface.
export const MOBILE_ARRIVAL_FRAME_PATHS = [
  "/sequences/lobby/frame-0001.webp",
  "/sequences/store/frame-0001.webp",
  "/sequences/records/frame-0001.webp",
  "/sequences/lounge/frame-0001.webp",
  "/sequences/lounge/frame-0192.webp",
] as const;

export const MOBILE_WALK_TRANSITIONS = MOBILE_WALK_ROOMS.map(
  (room, index) => ({
    room,
    startFrame: MOBILE_ARRIVAL_FRAME_PATHS[index],
    endFrame: MOBILE_ARRIVAL_FRAME_PATHS[index + 1],
  })
);
