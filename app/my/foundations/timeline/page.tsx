import { redirect } from "next/navigation";

// New Foundations work belongs in Practice. Explicit historical moment links
// continue through the owner-authorized Timeline route.
export default async function MyTimelinePage({ searchParams }: {
  searchParams?: Promise<{ moment?: string }>;
} = {}) {
  const query = await searchParams;
  if (query?.moment) redirect(`/my/timeline?moment=${encodeURIComponent(query.moment)}`);
  redirect("/my/practice?course=f1");
}
