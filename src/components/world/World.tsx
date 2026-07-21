import { MaterialsProvider } from "@/components/world/materials";
import Lobby from "@/components/rooms/Lobby";
import Store from "@/components/rooms/Store";
import Staircase from "@/components/rooms/Staircase";
import Archive from "@/components/rooms/Archive";
import Gallery from "@/components/rooms/Gallery";

// One connected building. Each room owns its own geometry and lights and is laid
// out contiguously along -Z, so the camera simply travels through them. The
// MaterialsProvider loads the shared texture set once for every surface.
export default function World() {
  return (
    <MaterialsProvider>
      <group>
        <Lobby />
        <Store />
        <Staircase />
        <Archive />
        <Gallery />
      </group>
    </MaterialsProvider>
  );
}
