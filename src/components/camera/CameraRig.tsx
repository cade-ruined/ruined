import { useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CAMERA_PATH } from "./cameraPath";
import { scrollState } from "@/utils/scrollState";
import { captureState } from "@/utils/captureState";

// The dolly. Rides the spline by normalized scroll progress, always looking one
// step ahead along the path's tangent (vanishing point stays centred). Position
// is eased toward the target for gentle lens inertia; a faint sine adds
// handheld breathing. No rotation/orbit — only forward travel + tiny stabilise.
//
// In capture mode the camera snaps exactly onto the spline (no easing, no
// breathing) so an offline frame sequence renders deterministically.
export default function CameraRig() {
  const camera = useThree((s) => s.camera);
  const target = useRef(new THREE.Vector3());
  const tangent = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());

  useFrame(() => {
    const p = Math.min(1, Math.max(0, scrollState.progress));
    CAMERA_PATH.getPointAt(p, target.current);
    CAMERA_PATH.getTangentAt(p, tangent.current);
    look.current.copy(target.current).add(tangent.current);

    if (captureState.active) {
      camera.position.copy(target.current);
      camera.lookAt(look.current);
      return;
    }

    // Very slight handheld breathing — kept small so the forward direction
    // always reads clearly and the horizon never wanders.
    const t = performance.now() / 1000;
    target.current.x += Math.sin(t * 0.4) * 0.01;
    target.current.y += Math.sin(t * 0.33) * 0.007;

    camera.position.lerp(target.current, 0.12);
    camera.lookAt(look.current);
  });

  return null;
}
