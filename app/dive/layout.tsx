import type { Metadata } from "next";
import { privateSharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  title: "Experimental 3D Dive",
  description: "Development preview of Ruined's real-time WebGL room engine.",
  robots: { index: false, follow: false },
};

export default function DiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
