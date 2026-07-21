import { Environment, Lightformer } from "@react-three/drei";
import { PALETTE } from "@/components/world/config";

// Restrained, physically-plausible light. A procedural environment map (built
// from a few Lightformers — no HDR download) gives soft image-based ambient and
// gentle reflections on the concrete floor and steel. On top: a cool
// sky/ground hemisphere for fill and one soft daylight direction raking in from
// the lobby windows. Warm practicals live inside each room (Pendant).
export default function Lighting() {
  return (
    <>
      <Environment resolution={256} frames={1}>
        {/* warm daylight slab, roughly where the lobby windows are */}
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#fff1da"
          position={[-8, 5, 3]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[12, 8, 1]}
        />
        {/* cool sky fill from above */}
        <Lightformer
          form="rect"
          intensity={0.7}
          color="#cdd6e4"
          position={[0, 10, -14]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[16, 16, 1]}
        />
        {/* soft dark ground so reflections don't wash out */}
        <Lightformer
          form="rect"
          intensity={0.25}
          color="#2a251d"
          position={[0, -6, -14]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[16, 16, 1]}
        />
      </Environment>

      <hemisphereLight args={["#cdd4de", "#26221c", 0.35]} />
      <ambientLight intensity={0.06} />
      <directionalLight position={[-9, 10, 8]} intensity={1.0} color={PALETTE.daylight} />
      <directionalLight position={[6, 6, -30]} intensity={0.22} color={"#dfe6ef"} />
    </>
  );
}
