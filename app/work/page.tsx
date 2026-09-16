import type { Metadata } from "next";
import ComingSoonGate from "@/components/ComingSoonGate";
import { sharingMetadata } from "@/lib/sharing";

const description = "Artifacts from Ruined are coming soon.";
export const metadata: Metadata = {
  title: "Artifacts",
  description,
  alternates: { canonical: "/work" },
  ...sharingMetadata({ title: "Artifacts", description, path: "/work" }),
};
export default function ArtifactsPage() { return <ComingSoonGate title="Artifacts" image="/ruined-work-shelf.webp" source="artifacts" />; }
