import type { Metadata } from "next";
import TimelineWorksheet from "@/components/foundations-call/TimelineWorksheet";
import { privateSharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  title: "Ruined Timeline — Part I",
  description: "What happened? What did I make it mean? Your Foundations 01 timeline worksheet.",
  robots: { index: false, follow: false },
};

export default function FoundationsTimelinePage() {
  return <TimelineWorksheet />;
}
