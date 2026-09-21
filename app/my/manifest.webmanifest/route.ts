import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export function GET() {
  const manifest: MetadataRoute.Manifest = {
    id: "/my",
    name: "Ruined",
    short_name: "Ruined",
    description: "Your Ruined membership.",
    start_url: "/my",
    // Keep same-origin sign-in and its callbacks inside the installed app.
    scope: "/",
    display: "standalone",
    background_color: "#141413",
    theme_color: "#141413",
    icons: [
      { src: "/member-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/favicon-ruined-mark-v2.png", sizes: "512x512", type: "image/png" },
    ],
  };

  return Response.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
