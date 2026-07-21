// A tiny shared singleton so the DOM scroll layer (Lenis + ScrollTrigger, which
// lives OUTSIDE the R3F reconciler) can hand normalized progress to the camera
// rig running inside useFrame — without bridging React context across the two
// renderers.
export const scrollState = {
  progress: 0, // 0 → 1 across the whole journey
};
