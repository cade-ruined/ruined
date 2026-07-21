import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Experimental 3D Dive",
  description: "Development preview of Ruined's real-time WebGL room engine.",
  robots: { index: false, follow: false },
};

export default function DiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
