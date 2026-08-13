import {
  SEQUENCE_ROOMS,
  sequenceFrameCount,
  sequenceFramePath,
} from "@/data/sequences";
import { EXPLORE_ROOM_IDS } from "@/data/navigation";
import mobileSequenceConfig from "@/data/mobile-sequence-config.json";

export const MOBILE_TRANSITION_SAMPLE_COUNT = mobileSequenceConfig.sampleCount;
export const MOBILE_TRANSITION_FRAME_WIDTH = mobileSequenceConfig.width;
export const MOBILE_TRANSITION_FRAME_HEIGHT = mobileSequenceConfig.height;

export const MOBILE_WALK_ROOMS = SEQUENCE_ROOMS;

export const MOBILE_SCENE_IDS = EXPLORE_ROOM_IDS;

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
  sequenceFramePath("lobby", 1),
  sequenceFramePath("store", 1),
  sequenceFramePath("records", 1),
  sequenceFramePath("lounge", 1),
  sequenceFramePath("lounge", sequenceFrameCount("lounge")),
] as const;

export const MOBILE_WALK_TRANSITIONS = MOBILE_WALK_ROOMS.map(
  (room, index) => ({
    room: room.id,
    frameCount: room.frameCount,
    startFrame: MOBILE_ARRIVAL_FRAME_PATHS[index],
    endFrame: MOBILE_ARRIVAL_FRAME_PATHS[index + 1],
  })
);
