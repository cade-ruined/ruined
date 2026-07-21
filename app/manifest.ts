import type { MetadataRoute } from "next";

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
      { src: "/ruined-hero-1.jpg", sizes: "1536x1024", type: "image/jpeg", form_factor: "wide" },
      { src: "/ruined-hero-1-portrait.jpg", sizes: "1024x1536", type: "image/jpeg", form_factor: "narrow" },
    ],
  };
}
