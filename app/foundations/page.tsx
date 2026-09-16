import type { Metadata } from "next";
import PresentationShell from "@/components/foundations/PresentationShell";
import { privateSharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  title: "Foundations",
  description:
    "Ruined Foundations — a shared beginning through Story, Philosophy, Culture, and Commitment.",
  robots: { index: false, follow: false },
};

export default function FoundationsPage() {
  return <PresentationShell />;
}
