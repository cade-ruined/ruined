import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { privateSharingMetadata } from "@/lib/sharing";
import { membershipWebsiteHref } from "@/lib/site";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  title: "Ruined Timeline — Part I",
  description: "What happened? What did I make it mean? Your private Foundations 01 timeline.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default function FoundationsTimelinePage() {
  redirect(membershipWebsiteHref("/my/foundations/timeline/part-1"));
}
