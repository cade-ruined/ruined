import type { Metadata } from "next";

// Artifacts currently live inside the immersive walk. Re-enable indexing when
// the standalone archive is intentionally restored to visitor navigation.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
