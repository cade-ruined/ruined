import { redirect } from "next/navigation";

export default async function FoundationsTimelinePartOnePage({ searchParams }: {
  searchParams: Promise<{ moment?: string; new?: string }>;
}) {
  const query = await searchParams;
  if (query.new === "1") redirect("/my/timeline/new");
  redirect(query.moment ? `/my/timeline?moment=${encodeURIComponent(query.moment)}` : "/my/timeline");
}
