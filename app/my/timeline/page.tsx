import type { Metadata } from "next";
import GuidedTimelinePage from "@/components/membership/GuidedTimelinePage";
export const metadata: Metadata = { title: "Your Timeline | Ruined" };
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ moment?: string; practice?: string; resume?: string }> }) {
  const { moment, practice, resume } = await searchParams;
  return <GuidedTimelinePage moment={moment} practice={practice === "f1"} resumePracticeDraft={practice === "f1" && resume === "1"} />;
}
