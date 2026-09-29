import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { privateSharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  title: "Foundations",
  description:
    "Ruined Foundations — a shared beginning through Story, Philosophy, Culture, and Commitment.",
  robots: { index: false, follow: false },
};

export default function FoundationsPage() {
  redirect("https://members.theruinedproject.com/my/foundations");
}
