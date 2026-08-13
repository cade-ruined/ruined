import type { Metadata } from "next";
import ComingSoonGate from "@/components/ComingSoonGate";
export const metadata: Metadata = { title: "Store · Coming Soon", description: "The next Ruined collection is coming soon.", alternates: { canonical: "/store" } };
export default function StorePage() { return <ComingSoonGate title="Store" image="/ruined-hero-store-4.webp" source="store" />; }
