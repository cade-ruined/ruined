"use client";

import dynamic from "next/dynamic";

// The scroll-scrubbed image-sequence experience — the photoreal counterpart to
// the real-time 3D at /dive. Client-only (canvas + Lenis need the browser).
const FrameSequence = dynamic(
  () => import("@/components/sequence/FrameSequence"),
  { ssr: false }
);

export default function SequencePage() {
  return <FrameSequence />;
}
