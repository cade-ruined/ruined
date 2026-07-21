import { DIMS } from "@/components/world/config";
import {
  Slab,
  SideWall,
  DoorWall,
  ArtFrame,
  Pendant,
  Box,
} from "@/components/world/primitives";

// Lower floor. Dense shelving of stored artifacts, lower warm ceiling, a
// doorway at the back through to the gallery.
export default function Archive() {
  const { hallHalf, lowerFloorY, wallT, door } = DIMS;
  const ceil = lowerFloorY + 3.4;
  const z0 = -25;
  const z1 = -38;
  return (
    <group>
      <Slab y={lowerFloorY} z0={z0} z1={z1} halfX={hallHalf} surface="floorLower" />
      <Slab y={ceil} z0={z0} z1={z1} halfX={hallHalf} surface="concreteDark" />
      <SideWall side={-1} halfX={hallHalf} z0={z0} z1={z1} y0={lowerFloorY} height={ceil - lowerFloorY} thickness={wallT} surface="concrete" />
      <SideWall side={1} halfX={hallHalf} z0={z0} z1={z1} y0={lowerFloorY} height={ceil - lowerFloorY} thickness={wallT} surface="brick" />
      <DoorWall z={z1} halfX={hallHalf} y0={lowerFloorY} height={ceil - lowerFloorY} thickness={wallT} door={door} surface="concrete" />

      {/* shelving stacks along the walls */}
      {[-29, -32, -35].map((z) =>
        [-1, 1].map((side) => (
          <Box
            key={`${z}-${side}`}
            position={[side * (hallHalf - 0.8), lowerFloorY + 1.1, z]}
            size={[0.9, 2.2, 1.8]}
            surface="wood"
            repeat={[0.6, 1.4]}
          />
        ))
      )}

      {[-28, -32, -36].map((z) => (
        <Pendant key={z} position={[0, ceil - 0.2, z]} intensity={5} distance={7} />
      ))}
      <ArtFrame side={-1} halfX={hallHalf} y={lowerFloorY + 1.7} z={-30} art="/art/loft.jpg" />
      <ArtFrame side={1} halfX={hallHalf} y={lowerFloorY + 1.7} z={-33} art="/art/shelf.jpg" />
    </group>
  );
}
