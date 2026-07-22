import type { MetadataRoute } from "next";
import { SEQUENCE_OPENING_FRAME } from "@/data/sequences";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ruined — After the Fear",
    short_name: "Ruined",
    description: "Artifacts, projects, and the Ruined studio.",
    start_url: "/",
    display: "standalone",
    background_color: "#080605",
    theme_color: "#080605",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
    screenshots: [
      {
        src: SEQUENCE_OPENING_FRAME,
        sizes: "1600x900",
        type: "image/webp",
        form_factor: "wide",
      },
    ],
  };
}
