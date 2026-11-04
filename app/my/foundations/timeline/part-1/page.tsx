import { redirect } from "next/navigation";

export default async function FoundationsTimelinePartOnePage({ searchParams }: {
  searchParams: Promise<{ moment?: string; new?: string }>;
}) {
  const query = await searchParams;
  if (query.moment) redirect(`/my/timeline?moment=${encodeURIComponent(query.moment)}`);
  redirect("/my/practice?course=f1");
}
