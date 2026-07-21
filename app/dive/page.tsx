"use client";

import dynamic from "next/dynamic";

// The immersive 3D flagship (React Three Fiber). Loaded client-only — the WebGL
// canvas can't render during SSR. Standalone review route while the engine is
// built out; it will replace the homepage hero once complete.
const Experience = dynamic(
  () => import("@/components/experience/Experience"),
  { ssr: false }
);

export default function DivePage() {
  return <Experience />;
}
