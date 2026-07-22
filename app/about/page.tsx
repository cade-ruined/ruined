import type { Metadata } from "next";
import AboutIndex from "@/components/about/AboutIndex";

export const metadata: Metadata = {
  title: "About · Studio No. 17",
  description:
    "Ruined is an independent multidisciplinary studio for limited objects, garments, spaces, and visual systems.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return <AboutIndex />;
}
