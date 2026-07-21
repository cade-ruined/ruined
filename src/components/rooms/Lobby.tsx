import { DIMS, PALETTE } from "@/components/world/config";
import {
  Slab,
  SideWall,
  DoorWall,
  Bench,
  ArtFrame,
  Pendant,
  Box,
} from "@/components/world/primitives";

// The arrival hall. Open at the front (the camera stands here), brick + concrete
// walls, daylight through tall windows on the left, a doorway at the back that
// leads into the store.
export default function Lobby() {
  const { hallHalf, ceilingUpper, wallT, door } = DIMS;
  const z0 = 6;
  const z1 = -9;
  return (
    <group>
      <Slab y={0} z0={z0} z1={z1} halfX={hallHalf} surface="floor" />
      <Slab y={ceilingUpper} z0={z0} z1={z1} halfX={hallHalf} surface="plaster" />
      <SideWall side={-1} halfX={hallHalf} z0={z0} z1={z1} y0={0} height={ceilingUpper} thickness={wallT} surface="brick" />
      <SideWall side={1} halfX={hallHalf} z0={z0} z1={z1} y0={0} height={ceilingUpper} thickness={wallT} surface="concrete" />
      <DoorWall z={z1} halfX={hallHalf} y0={0} height={ceilingUpper} thickness={wallT} door={door} surface="concrete" />

      {/* Tall windows on the brick (left) wall — emissive panels read as daylight */}
      {[1, -3].map((z) => (
        <Box
          key={z}
          position={[-hallHalf + 0.16, 1.9, z]}
          size={[0.05, 2.6, 1.6]}
          color={PALETTE.daylight}
          emissive={PALETTE.daylight}
          emissiveIntensity={1.6}
          roughness={1}
        />
      ))}

      <Bench position={[-3.1, 0, 2]} />
      <ArtFrame side={1} halfX={hallHalf} y={1.8} z={-2} art="/art/shelf.jpg" />
      <ArtFrame side={1} halfX={hallHalf} y={1.8} z={-6} art="/art/records.jpg" />
      <Pendant position={[0, ceilingUpper - 0.2, -4]} intensity={7} />
      <Pendant position={[0, ceilingUpper - 0.2, 1]} intensity={5} />
    </group>
  );
}
