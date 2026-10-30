import type { Metadata } from "next";
import GuidedTimelinePage from "@/components/membership/GuidedTimelinePage";
export const metadata: Metadata = { title: "Your Timeline | Ruined" };
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ moment?: string }> }) {
  const { moment } = await searchParams;
  return <GuidedTimelinePage moment={moment} />;
}
