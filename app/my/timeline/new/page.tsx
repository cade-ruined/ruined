import type { Metadata } from "next";
import GuidedTimelinePage from "@/components/membership/GuidedTimelinePage";
export const metadata: Metadata = { title: "Add to your Timeline | Ruined" };
export const dynamic = "force-dynamic";
export default function Page() { return <GuidedTimelinePage startNew />; }
