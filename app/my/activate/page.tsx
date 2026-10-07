import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MemberActivation from "@/components/membership/MemberActivation";
import { MembershipEntryProgress, MembershipEntryProgressProvider } from "@/components/membership/MembershipEntryProgress";
import { membershipEntryStage } from "@/lib/membership/entry-stage";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_ONBOARDING } from "@/lib/membership/preview";
import { getMemberOnboarding } from "@/lib/membership/repository";
import { getMemberRegistration } from "@/lib/membership/registration-repository";
import { getMemberSignupPlan } from "@/lib/membership/public-signup-admission";
import { getMembershipFirstChargeAt } from "@/lib/membership/paid-launch";
import { isMembershipCohortPrepaymentEnabled } from "@/lib/membership/cohort-prepayment";
import { createFoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { getCoupleMembershipAuthorization, getCurrentCommercialMembershipReservation } from "@/lib/membership/commercial-repository";
import { requireActivePlatformMemberLink } from "@/lib/platform/repository";
import { getStripePublishableKey } from "@/lib/platform/config";

export const metadata: Metadata = { title: "Membership checkout | Ruined", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MembershipActivationPage({ searchParams }: {
  searchParams: Promise<{ checkout?: string; view?: string; coupleAuthorization?: string }>;
}) {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_ONBOARDING, getMemberOnboarding, "activation");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const parameters = await searchParams;
  const preview = context.state === "preview";
  const registration = context.viewer ? await getMemberRegistration(context.viewer.authUserId) : null;
  const complimentary = context.data.membershipFunding === "operator" || context.data.membershipFunding === "complimentary";
  const completingRegistration = preview ? context.configuration.membershipPrepaymentRequired :
    Boolean(registration?.requiresInitialPayment && registration.state !== "activated" &&
      (!registration.registeredAt || parameters.checkout === "returned"));
  if (!preview && completingRegistration && !registration?.profileComplete) redirect("/my/join");
  const registrationReady = !registration || registration.state === "activated" || registration.ready || (registration.requiresInitialPayment && registration.profileComplete);
  const expectedAgreement = process.env.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION?.trim();
  const agreementReady = preview || Boolean(expectedAgreement && `ruined_membership-v${context.data.agreement.version}` === expectedAgreement);
  const enabled = !preview && !complimentary && registrationReady && context.data.requiredFieldsComplete && agreementReady &&
    (context.configuration.stripeActivationReady || context.configuration.stripeCheckoutReady);
  const initialPlan = context.viewer ? await getMemberSignupPlan(context.viewer.authUserId) ?? "monthly" : "monthly";
  const platformUser = context.viewer && !preview ? await requireActivePlatformMemberLink(context.viewer) : null;
  let agreementOnlyReturnHref: string | undefined;
  if (parameters.coupleAuthorization && !preview) {
    const authorizationId = parameters.coupleAuthorization;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authorizationId)) redirect("/my/couple");
    const authorization = await getCoupleMembershipAuthorization(authorizationId);
    if (!authorization || authorization.partnerMemberId !== platformUser?.memberId || authorization.revokedAt || authorization.expiresAt <= new Date()) {
      return <PlatformUnavailable reason="member_access" />;
    }
    agreementOnlyReturnHref = `/my/couple?authorization=${encodeURIComponent(authorizationId)}`;
  }
  const currentOffer = platformUser ? await getCurrentCommercialMembershipReservation(platformUser.memberId) : null;
  const prepaid = isMembershipCohortPrepaymentEnabled();
  const billingSchedule = currentOffer ? currentOffer.billingSchedule ?? null
    : prepaid ? createFoundationsBillingSchedule(new Date(), initialPlan) : null;
  const firstChargeAt = currentOffer ? currentOffer.firstChargeAt?.toISOString() ?? null
    : billingSchedule ? null : preview ? "2026-11-01T06:00:00.000Z" : getMembershipFirstChargeAt()?.toISOString() ?? null;
  const disabledReason = preview ? "Preview only. No agreement is accepted and no billing is authorized."
    : complimentary ? "Your membership is complimentary. No payment is needed."
      : !registrationReady || !context.data.requiredFieldsComplete ? "Complete your registration before confirming membership billing."
        : !enabled ? "Membership activation is not available yet. Existing billing can still be managed below." : null;
  const initialStage = preview ? parameters.view === "agreement" ? "agreement" : "payment"
    : membershipEntryStage(context.data.requiredFieldsComplete, Boolean(context.data.agreement.acceptanceId));
  return <MembershipEntryProgressProvider initialStage={initialStage}><main className="mx-auto min-h-[72vh] max-w-3xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
    {completingRegistration ? <MembershipEntryProgress /> : null}
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-red)]">Ruined membership</p>
    <h1 className="mt-4 font-[var(--font-display)] text-[clamp(2.5rem,7vw,3.75rem)] leading-[1.04] tracking-[-0.04em]">{agreementOnlyReturnHref ? "Your shared membership." : completingRegistration ? "Make it official." : "Your membership."}</h1>
    <MemberActivation
      onboarding={context.data}
      enabled={enabled}
      disabledReason={disabledReason}
      initialPlan={initialPlan}
      firstChargeAt={firstChargeAt}
      billingSchedule={billingSchedule}
      minimumAge={context.configuration.minimumAge}
      publishableKey={getStripePublishableKey()}
      completingRegistration={completingRegistration}
      agreementOnlyReturnHref={agreementOnlyReturnHref}
      returnedFromCheckout={parameters.checkout === "returned"}
      preview={preview}
      previewView={preview && ["agreement", "scheduled", "canceled"].includes(parameters.view ?? "") ? parameters.view as "agreement" | "scheduled" | "canceled" : "offer"}
    />
  </main></MembershipEntryProgressProvider>;
}
