import { DIMS, PALETTE } from "@/components/world/config";
import { SideWall, Box } from "@/components/world/primitives";

// A double-height stairwell connecting the upper retail floor to the lower
// floor. Steel treads descend on the centre line; a warm glow rises from the
// level below to draw the visitor down.
const STEPS = 13;

export default function Staircase() {
  const { hallHalf, ceilingUpper, lowerFloorY, wallT } = DIMS;
  const z0 = -20.5;
  const z1 = -25;
  const height = ceilingUpper - lowerFloorY; // tall void

  const treads = Array.from({ length: STEPS }, (_, i) => {
    const t = i / (STEPS - 1);
    const z = -20.9 + t * (z1 - (-20.9) - 0.2);
    const y = -0.15 + t * (lowerFloorY + 0.2 - -0.15);
    return { z, y, key: i };
  });

  return (
    <group>
      <SideWall side={-1} halfX={hallHalf} z0={z0} z1={z1} y0={lowerFloorY} height={height} thickness={wallT} surface="concrete" />
      <SideWall side={1} halfX={hallHalf} z0={z0} z1={z1} y0={lowerFloorY} height={height} thickness={wallT} surface="concrete" />

      {treads.map((s) => (
        <group key={s.key}>
          <Box position={[0, s.y, s.z]} size={[2.4, 0.16, 0.46]} surface="wood" repeat={[1.6, 0.3]} />
          <Box position={[0, s.y - 0.24, s.z]} size={[2.2, 0.32, 0.04]} surface="steel" />
        </group>
      ))}

      {/* railings */}
      {[-1, 1].map((side) => (
        <Box
          key={side}
          position={[side * 1.25, -2.1, (z0 + z1) / 2]}
          size={[0.06, 0.06, Math.abs(z1 - z0)]}
          surface="steel"
        />
      ))}

      {/* warm glow rising from below */}
      <mesh position={[0, lowerFloorY + 0.11, z1 - 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3, 2]} />
        <meshStandardMaterial color={PALETTE.glowWarm} emissive={PALETTE.glowWarm} emissiveIntensity={1.2} />
      </mesh>
      <pointLight position={[0, lowerFloorY + 1.2, z1]} intensity={7} distance={9} decay={2} color={PALETTE.glowWarm} />
    </group>
  );
}
