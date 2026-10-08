import type { Metadata } from "next";
import FoundationsCallDeck from "@/components/foundations-call/FoundationsCallDeck";
import { privateSharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  title: "Foundations 01",
  description: "Your story. Our story. The first Ruined Foundations conversation.",
  robots: { index: false, follow: false },
};

export default function FoundationsOnePage() {
  return <FoundationsCallDeck />;
}
