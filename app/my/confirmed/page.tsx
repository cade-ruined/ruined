import type { Metadata } from "next";
import { cookies } from "next/headers";

import MemberEmailConfirmationStatus from "@/components/platform/MemberEmailConfirmationStatus";
import { MEMBER_INVITATION_CONTEXT_COOKIE } from "@/lib/auth/request";
import { MEMBER_INVITATION_TOKEN } from "@/lib/membership/invitation-model";
import { privateSharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  title: "Email confirmation",
  description: "Review the status of a Ruined Membership email confirmation.",
  referrer: "no-referrer",
};

export default async function MyRuinedEmailConfirmedPage() {
  // This cookie supplies navigation context only. The invitation and verified
  // recipient are checked again when the member accepts it.
  const cookieStore = await cookies();
  const invitation = cookieStore.get(MEMBER_INVITATION_CONTEXT_COOKIE)?.value;
  const invitationToken = typeof invitation === "string" && MEMBER_INVITATION_TOKEN.test(invitation)
    ? invitation
    : undefined;
  return (
    <main className="member-journey-page member-confirmation-page grid min-h-[68vh] gap-14 border-t border-[var(--member-rule)] pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:gap-24">
      <div>
        <p className="font-[var(--font-handwritten)] text-xl text-[var(--color-poster)]">
          RUINED MEMBERSHIP / EMAIL
        </p>
        <h1 className="mt-12 max-w-4xl font-[var(--font-display)] text-[clamp(3.8rem,9vw,8.5rem)] leading-[0.84] tracking-[-0.055em]">
          A place with your name on it.
        </h1>
      </div>

      <MemberEmailConfirmationStatus invitationToken={invitationToken} />
    </main>
  );
}
