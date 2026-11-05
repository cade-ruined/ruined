import type { Metadata } from "next";
import PublicMemberProfilePage from "@/components/membership/PublicMemberProfilePage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Profile / Ruined", description: "A Ruined member and their public Timeline.",
  robots: { index: false, follow: false }, referrer: "no-referrer", alternates: { canonical: null },
};
export default async function PublicJournalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return PublicMemberProfilePage({ identifier: token });
}
