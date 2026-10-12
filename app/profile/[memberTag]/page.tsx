import PublicJournalPage from "../../journal/[token]/page";
export { metadata } from "../../journal/[token]/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicProfilePage({ params }: { params: Promise<{ memberTag: string }> }) {
  const { memberTag } = await params;
  return PublicJournalPage({ params: Promise.resolve({ token: memberTag }) });
}
