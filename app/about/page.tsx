import type { Metadata } from "next";
import ComingSoonGate from "@/components/ComingSoonGate";
export const metadata: Metadata = { title: "About · Coming Soon", alternates: { canonical: "/about" } };
export default function AboutPage() { return <ComingSoonGate title="About" image="/ruined-hero-1.jpg" source="about" signup={false} />; }
