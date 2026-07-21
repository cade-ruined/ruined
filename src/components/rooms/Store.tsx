import { DIMS } from "@/components/world/config";
import {
  Slab,
  SideWall,
  Rack,
  Bench,
  ArtFrame,
  Pendant,
  Box,
} from "@/components/world/primitives";

// The retail floor. Runs from the lobby doorway to the edge of the stairwell,
// where a low steel railing signals the descent. Racks line both walls, a bench
// sits on centre, artwork on the vanishing axis.
export default function Store() {
  const { hallHalf, ceilingUpper, wallT } = DIMS;
  const z0 = -9;
  const z1 = -20.5; // floor stops at the stairwell edge
  return (
    <group>
      <Slab y={0} z0={z0} z1={z1} halfX={hallHalf} surface="floor" />
      <Slab y={ceilingUpper} z0={z0} z1={z1} halfX={hallHalf} surface="plaster" />
      <SideWall side={-1} halfX={hallHalf} z0={z0} z1={z1} y0={0} height={ceilingUpper} thickness={wallT} surface="concrete" />
      <SideWall side={1} halfX={hallHalf} z0={z0} z1={z1} y0={0} height={ceilingUpper} thickness={wallT} surface="concrete" />

      {[-11.5, -14, -16.5].map((z) => (
        <group key={z}>
          <Rack position={[-hallHalf + 0.9, 0, z]} />
          <Rack position={[hallHalf - 0.9, 0, z]} />
        </group>
      ))}

      <Bench position={[0, 0, -14]} />
      <ArtFrame side={-1} halfX={hallHalf} y={1.9} z={-13} art="/art/store.jpg" />
      <ArtFrame side={1} halfX={hallHalf} y={1.9} z={-13} art="/art/lounge.jpg" />

      {/* Railing at the stairwell edge */}
      <Box position={[0, 0.5, z1]} size={[hallHalf * 2 - 2.6, 0.06, 0.06]} surface="steel" />

      {[-11, -14.5, -18].map((z) => (
        <Pendant key={z} position={[0, ceilingUpper - 0.2, z]} intensity={6} />
      ))}
    </group>
  );
}
