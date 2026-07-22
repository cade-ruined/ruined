import type { Metadata } from "next";
import WorkIndex from "@/components/work/WorkIndex";

export const metadata: Metadata = {
  title: "Work · The Ruined Projects",
  description:
    "Selected objects, spaces, garments, and visual systems from the Ruined project archive.",
  alternates: { canonical: "/work" },
};

export default function WorkPage() {
  return <WorkIndex />;
}
