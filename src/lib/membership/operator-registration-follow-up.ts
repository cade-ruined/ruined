import type { OpsMemberRegistration } from "./registration-model";
import type { OperatorMemberJourney } from "./operator-registration-progress";
import { getMemberAccessUrl } from "@/lib/auth/support-return";

const MEMBER_SITE = "https://members.theruinedproject.com";

export type OperatorRegistrationFollowUp = {
  kind: "share" | "review" | "release" | "complete";
  title: string;
  detail: string;
  operatorHref: string;
  recipient?: string;
  memberUrl?: string;
  message?: string;
};

/** Copyable instructions only. Never sends a message, charges a card or releases access. */
export function operatorRegistrationFollowUp(row: OpsMemberRegistration, journey: OperatorMemberJourney | null): OperatorRegistrationFollowUp {
  const operatorHref = `/ops/members/${encodeURIComponent(row.memberId)}?returnTo=%2Fops%2Fregistrations#membership`;
  const review = (title: string, detail: string): OperatorRegistrationFollowUp => ({ kind: "review", title, detail, operatorHref });
  const share = (title: string, detail: string, destination: "/my" | "/my/join" | "/my/activate" | null, message: string, recipient = row.email): OperatorRegistrationFollowUp => {
    const memberUrl = `${MEMBER_SITE}${destination ? getMemberAccessUrl(destination) : "/access"}`;
    return { kind: "share", title, detail, operatorHref, recipient, memberUrl,
      message: `${message}\n\n${memberUrl}\n\nSign in with ${recipient}. We'll email you a confirmation code.` };
  };
  if (!journey || journey.next.key === "review") return review("Review this registration", journey?.attention ?? journey?.next.detail ?? "Open the member record and check their registration before sending a follow-up.");
  switch (journey.next.key) {
    case "email":
      return share("Send the email confirmation link", "Ask them to open this link and enter the code sent to their registration email.", null, "Confirm your email to continue your Ruined registration.");
    case "information":
      return share("Send the registration link", "Ask them to finish their information and accept the registration terms.", "/my/join", "Finish your information and registration terms to continue joining Ruined.");
    case "payment":
      if (row.progress?.paidCheckoutAvailable === false) return review("Hold payment follow-up", "Paid checkout is not open. Review billing availability before sending a payment request.");
      if (row.progress?.paymentByPartner) {
        if (!row.couplePartnerEmail || row.coupleStatus !== "paired") return review("Confirm the paying partner", "This member shares billing with their partner. Confirm who is paying before following up; do not request a separate payment from this member.");
        return share("Follow up with the paying partner", "Send this to their partner for the shared membership payment. This member does not need a separate checkout.", "/my/activate", "Complete checkout for your shared Ruined membership. You'll review the price and membership terms before paying securely through Stripe.", row.couplePartnerEmail);
      }
      return share(row.progress?.checkoutStarted ? "Send the checkout resume link" : "Send the payment link",
        row.progress?.checkoutStarted ? "They can resume checkout here. If they say they already paid, review billing before asking them to try again."
          : "Ask them to review the price and membership terms, then pay through Stripe. This link also works if they already saved a card.",
        "/my/activate", "Complete your Ruined membership checkout. You'll review the price and membership terms before paying securely through Stripe.");
    case "profile":
      return { kind: "release", title: "Review and grant profile access", detail: "When you're ready, review this member and open their profile. The profile-access email is sent automatically after you confirm.", operatorHref };
    case "complete":
      return { kind: "complete", title: "No onboarding follow-up needed", detail: "All five checkpoints are complete and their profile is open.", operatorHref };
  }
}
