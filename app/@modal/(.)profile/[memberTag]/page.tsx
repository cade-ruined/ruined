import PublicMemberProfilePage from "@/components/membership/PublicMemberProfilePage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfileModalPage({ params }: { params: Promise<{ memberTag: string }> }) {
  const { memberTag } = await params;
  return <PublicMemberProfilePage identifier={memberTag} embedded />;
}
