import { DIMS, PALETTE } from "@/components/world/config";
import {
  Slab,
  SideWall,
  DoorWall,
  ArtFrame,
  Pendant,
  Box,
} from "@/components/world/primitives";

// Real Ruined pieces hung around the gallery.
const GALLERY_ART = [
  "/art/records.jpg",
  "/art/store.jpg",
  "/art/lounge.jpg",
  "/art/loft.jpg",
  "/art/shelf.jpg",
];

// The final room — a quiet gallery of framed works, ending at a bright doorway
// to the exit.
export default function Gallery() {
  const { hallHalf, lowerFloorY, wallT, door } = DIMS;
  const ceil = lowerFloorY + 3.4;
  const z0 = -38;
  const z1 = -50;
  return (
    <group>
      <Slab y={lowerFloorY} z0={z0} z1={z1} halfX={hallHalf} surface="floorLower" />
      <Slab y={ceil} z0={z0} z1={z1} halfX={hallHalf} surface="plaster" />
      <SideWall side={-1} halfX={hallHalf} z0={z0} z1={z1} y0={lowerFloorY} height={ceil - lowerFloorY} thickness={wallT} surface="plaster" />
      <SideWall side={1} halfX={hallHalf} z0={z0} z1={z1} y0={lowerFloorY} height={ceil - lowerFloorY} thickness={wallT} surface="plaster" />
      <DoorWall z={z1} halfX={hallHalf} y0={lowerFloorY} height={ceil - lowerFloorY} thickness={wallT} door={door} frame={false} />

      {/* bright daylight beyond the exit */}
      <Box
        position={[0, lowerFloorY + door.h / 2, z1 - 0.2]}
        size={[door.w, door.h, 0.05]}
        color={PALETTE.daylight}
        emissive={PALETTE.daylight}
        emissiveIntensity={2.2}
      />

      {[-41, -44, -47].map((z, zi) =>
        [-1, 1].map((side, si) => {
          const art = GALLERY_ART[(zi * 2 + si) % GALLERY_ART.length];
          return (
            <ArtFrame
              key={`${z}-${side}`}
              side={side as 1 | -1}
              halfX={hallHalf}
              y={lowerFloorY + 1.7}
              z={z}
              w={1.3}
              h={1.9}
              art={art}
            />
          );
        })
      )}

      {[-41, -45].map((z) => (
        <Pendant key={z} position={[0, ceil - 0.2, z]} intensity={5} distance={7} />
      ))}
    </group>
  );
}
