import { EffectComposer, N8AO, Bloom, Vignette } from "@react-three/postprocessing";

// A quiet, filmic finishing pass. N8AO adds soft contact darkening in corners
// and where props meet the floor (the single biggest "this is a real room" cue).
// Bloom only touches the warm practicals and daylight. A faint vignette settles
// the edges. Everything is deliberately subtle — no HDR glare, no neon.
export default function PostFX() {
  return (
    <EffectComposer multisampling={4} enableNormalPass>
      <N8AO
        aoRadius={1.4}
        distanceFalloff={1.0}
        intensity={2.2}
        quality="medium"
        halfRes
        color="#000000"
      />
      <Bloom
        intensity={0.35}
        luminanceThreshold={0.72}
        luminanceSmoothing={0.25}
        mipmapBlur
      />
      <Vignette offset={0.32} darkness={0.62} eskil={false} />
    </EffectComposer>
  );
}
