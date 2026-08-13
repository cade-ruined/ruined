import type { Metadata } from "next";
import ComingSoonGate from "@/components/ComingSoonGate";
export const metadata: Metadata = { title: "Artifacts · Coming Soon", description: "Artifacts from The Ruined Project are coming soon.", alternates: { canonical: "/work" } };
export default function ArtifactsPage() { return <ComingSoonGate title="Artifacts" image="/ruined-work-shelf.webp" source="artifacts" />; }
