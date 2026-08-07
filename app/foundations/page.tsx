import type { Metadata } from "next";
import PresentationShell from "@/components/foundations/PresentationShell";

export const metadata: Metadata = {
  title: "Foundations",
  description:
    "Ruined Foundations — a shared beginning through Story, Philosophy, Culture, and Commitment.",
  alternates: { canonical: "/foundations" },
  openGraph: {
    title: "Ruined Foundations",
    description:
      "A shared beginning through Story, Philosophy, Culture, and Commitment.",
    url: "/foundations",
  },
};

export default function FoundationsPage() {
  return <PresentationShell />;
}
