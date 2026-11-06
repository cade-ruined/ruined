import type { Metadata } from "next";
import GuidedTimelinePage from "@/components/membership/GuidedTimelinePage";
export const metadata: Metadata = { title: "Add to your Timeline | Ruined" };
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ practice?: string; resume?: string }> }) {
  const { practice, resume } = await searchParams;
  return <GuidedTimelinePage startNew practice={practice === "f1"} resumePracticeDraft={practice === "f1" && resume === "1"} />;
}
