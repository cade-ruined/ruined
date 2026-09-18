import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { memberCardPreviewSnapshot } from "@/lib/membership/public-card-preview";
import PublicMemberCardPage from "@/components/membership/card/PublicMemberCardPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Member card preview", robots: { index: false, follow: false } };
export default function PreviewCardPage() {
  if (getPlatformConfiguration().mode !== "preview") notFound();
  return <PublicMemberCardPage card={memberCardPreviewSnapshot().card} preview />;
}
