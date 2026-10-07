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

type ReadinessResult = {
  ready: boolean;
  checks?: { configuration: boolean; agreement: boolean; prices: boolean; portal: boolean };
  error?: string;
};

function respond(request: Request, body: ReadinessResult, status = 200) {
  const headers = { "Cache-Control": "no-store", Vary: "Accept" };
  if (!request.headers.get("accept")?.toLowerCase().includes("text/html")) {
    return NextResponse.json(body, { status, headers });
  }
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const rows = body.checks ? [
    ["Configuration", body.checks.configuration], ["Published agreement", body.checks.agreement],
    ["All six membership prices", body.checks.prices], ["Commitment portal", body.checks.portal],
  ].map(([label, passed]) => `<li>${label}: <strong>${passed === true ? "true" : "false"}</strong></li>`).join("") : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ruined billing readiness</title></head><body><main><h1>Billing readiness</h1><p>Ready: <strong>${body.ready === true ? "true" : "false"}</strong></p>${body.error ? `<p>${escape(body.error)}</p>` : ""}${rows ? `<ul>${rows}</ul>` : ""}</main></body></html>`;
  return new Response(html, { status, headers: {
    ...headers, "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  } });
}

export async function GET(request: Request) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return respond(request, { ready: false, error: "Sign in required." }, 401);
    if (await getOperatorRole(viewer.authUserId) !== "ops_admin") {
      return respond(request, { ready: false, error: "Administrator access required." }, 403);
    }

    const checks = { configuration: getPlatformConfiguration().stripeActivationReady, agreement: false, prices: false, portal: false };
    if (!checks.configuration) return respond(request, { ready: false, checks });

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
    return respond(request, { ready: Object.values(checks).every(Boolean), checks });
  } catch {
    return respond(request, { ready: false, error: "Billing readiness could not be checked." }, 503);
  }
}
