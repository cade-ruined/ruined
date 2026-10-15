import type { Metadata } from "next";
import { redirect } from "next/navigation";

import CirclePersonProfile, { type CirclePersonRole } from "@/components/membership/CirclePersonProfile";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import type { PrivacySafePersonSummary } from "@/lib/membership/model";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_CIRCLE } from "@/lib/membership/preview";
import { getMemberCircle } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Circle Profile | Ruined Membership" };
export const dynamic = "force-dynamic";

type CirclePersonData = {
  circleName: string;
  person: PrivacySafePersonSummary;
  role: CirclePersonRole;
};

function personFromCircle(
  circle: Awaited<ReturnType<typeof getMemberCircle>> | typeof PREVIEW_MEMBER_CIRCLE,
  personId: string,
): CirclePersonData | null {
  if (!circle?.circle) return null;
  const member = circle.members.find((person) => person.id === personId);
  if (member) return { circleName: circle.circle.name, person: member, role: "member" };
  if (circle.shaper?.id === personId) {
    return { circleName: circle.circle.name, person: circle.shaper, role: "shaper" };
  }
  return null;
}

export default async function CirclePersonPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const context = await getMembershipPageContext(
    PREVIEW_MEMBER_CIRCLE,
    getMemberCircle,
    "Circle profile",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  // Older links refer to Circle assignments that may have changed. Send the
  // authorized viewer back to their current roster so they can choose a profile.
  const profile = personFromCircle(context.data, personId);
  if (!profile) redirect("/my/circle");
  if (profile.person.publicProfileHref) redirect(profile.person.publicProfileHref);
  return <CirclePersonProfile {...profile} />;
}
