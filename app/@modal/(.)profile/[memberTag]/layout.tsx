import type { ReactNode } from "react";
import MemberProfileModal from "@/components/membership/MemberProfileModal";

export default async function ProfileModalLayout({ children, params }: {
  children: ReactNode; params: Promise<{ memberTag: string }>;
}) {
  const { memberTag } = await params;
  return <MemberProfileModal profileHref={`/profile/${encodeURIComponent(memberTag)}`}>{children}</MemberProfileModal>;
}
