import { redirect } from "next/navigation";

export default async function MyLearningResourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/my/library/${encodeURIComponent(slug)}`);
}
