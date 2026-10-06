import { getPlatformConfiguration } from "@/lib/platform/config";
import { createRegistrationEmail } from "@/lib/membership/registration-email";
import { foundationsBillingScheduleForMonth } from "@/lib/membership/foundations-schedule";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Fictional local visual proof. Never exposes an actual recipient or sends mail. */
export function GET(request: Request) {
  if (process.env.NODE_ENV==="production" || getPlatformConfiguration().mode!=="preview") {
    return new Response("Not found",{status:404});
  }
  const url=new URL(request.url);
  const kind=url.searchParams.get("kind")==="profile_ready" ? "profile_ready" : "welcome";
  const foundingPricing = url.searchParams.get("pricing") === "founding" ? {
    confirmed: true as const, awardedAt: "2026-10-02T18:00:00.000Z",
    monthlyAmountCents: 34_900, annualAmountCents: 349_000, currency: "usd" as const,
  } : null;
  const paid = url.searchParams.get("funding") === "paid";
  const plan = url.searchParams.get("plan") === "annual" ? "annual" as const : "monthly" as const;
  const couple = url.searchParams.get("pricing") === "couple";
  const dues = (foundingPricing ? 34_900 : couple ? 69_900 : 49_900) * (plan === "annual" ? 10 : 1);
  const message=createRegistrationEmail({kind,memberName:"Alex Rivera",
    completionBasis:paid ? "paid_membership" : url.searchParams.get("funding")==="complimentary" ? "complimentary" : "saved_card",
    foundingPricing,
    paidMembership:paid ? {
      offerId:`${foundingPricing ? "founding_individual" : couple ? "couple" : "individual"}_${plan}`,
      billingPlan:plan,amountPaidCents:dues,duesAmountCents:dues,currency:"usd",paidAt:"2026-10-06T18:00:00.000Z",
      billingSchedule:foundationsBillingScheduleForMonth(url.searchParams.get("cohort")==="december" ? "2026-12" : "2026-11",plan),
      agreementVersion:"ruined_membership-v3",initialTermAmountCents:dues*(plan==="annual" ? 1 : 12),
      buyoutCapCents:150_000,isPayer:!couple || url.searchParams.get("participant")!=="partner",
    } : null,
    invitationImageSrc:kind==="welcome" ? `/api/preview/registration-email/image?source=${url.searchParams.get("source")==="member" ? "member" : "direct"}` : undefined,
    siteUrl:new URL(url.origin)});
  // Next can normalize the request host to localhost while the browser uses
  // 127.0.0.1. Keep preview images on the browser's origin for its strict CSP;
  // the actual transactional email renderer retains absolute public URLs.
  const previewHtml=message.html.replaceAll(`${url.origin}/`,'/');
  const text=url.searchParams.get("format")==="text";
  return new Response(text ? message.text : previewHtml,{headers:{
    "Content-Type":text ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
    "Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow",
    "Content-Security-Policy":"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'",
  }});
}
