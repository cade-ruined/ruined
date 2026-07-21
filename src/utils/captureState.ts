// When capturing an offline frame sequence we need the camera to sit EXACTLY on
// the spline point for a given progress — no lerp inertia, no handheld breathing
// — so each rendered frame is deterministic and the sequence plays back smooth.
export const captureState = {
  active: false,
};
