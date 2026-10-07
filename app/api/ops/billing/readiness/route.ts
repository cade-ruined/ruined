import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { MEMBERSHIP_OFFERS, type MembershipOfferId } from "@/lib/membership/pricing";
import { getPublishedMembershipAgreement } from "@/lib/membership/published-agreement";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOperatorRole } from "@/lib/platform/repository";
import { validateMembershipPortalConfiguration } from "@/lib/stripe/portal";
import { getPaidMembershipAgreementVersion, validateStripeMembershipOfferPrice } from "@/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return json({ ready: false, error: "Sign in required." }, 401);
    if (await getOperatorRole(viewer.authUserId) !== "ops_admin") {
      return json({ ready: false, error: "Administrator access required." }, 403);
    }

    const checks = { configuration: getPlatformConfiguration().stripeActivationReady, agreement: false, prices: false, portal: false };
    if (!checks.configuration) return json({ ready: false, checks });

    // These are independent reads using the deployed app's credentials. Never
    // return provider objects, identifiers, or error details from this endpoint.
    const [agreement, prices, portal] = await Promise.allSettled([
      (async () => {
        const version = getPaidMembershipAgreementVersion();
        const prepaid = process.env.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED?.trim().toLowerCase() === "true";
        if (!/^ruined_membership-v([2-9]|[1-9]\d+)$/.test(version)
          || (prepaid && !/^ruined_membership-v([3-9]|[1-9]\d+)$/.test(version))) return false;
        return Boolean(await getPublishedMembershipAgreement(version));
      })(),
      (async () => {
        const offers = Object.keys(MEMBERSHIP_OFFERS) as MembershipOfferId[];
        const results = await Promise.allSettled(offers.map(async (offerId) => validateStripeMembershipOfferPrice(offerId)));
        return results.every((result) => result.status === "fulfilled");
      })(),
      (async () => { await validateMembershipPortalConfiguration("commitment"); return true; })(),
    ]);
    checks.agreement = agreement.status === "fulfilled" && agreement.value;
    checks.prices = prices.status === "fulfilled" && prices.value;
    checks.portal = portal.status === "fulfilled" && portal.value;
    return json({ ready: Object.values(checks).every(Boolean), checks });
  } catch {
    return json({ ready: false, error: "Billing readiness could not be checked." }, 503);
  }
}
