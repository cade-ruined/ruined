import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { PlatformAccessDeniedError } from "@/lib/platform/repository";
import { CommercialMembershipError } from "@/lib/membership/commercial-repository";
import { MembershipCheckoutConflictError } from "@/lib/stripe/billing-repository";
import { isMembershipBillingPlan } from "@/lib/membership/pricing";
import { isUuid } from "@/lib/stripe/membership-state";
import { getApplicationOrigin } from "@/lib/stripe/server";
import { OPERATOR_MEMBERSHIP_AUTHORITY_VERSION, OperatorMembershipError } from "@/lib/stripe/operator-membership-model";
import { operatorMembershipStatus, quoteOperatorMembership, startOperatorMembershipCheckout } from "@/lib/stripe/operator-membership-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ memberId: string }> };
function failure(error: unknown) {
  if (error instanceof PlatformAccessDeniedError) return opsJson({ error: "Administrator access is required." }, 403);
  if (error instanceof OperatorMembershipError) return opsJson({ error: error.message, code: error instanceof OperatorMembershipError ? error.code : undefined, plan: error instanceof OperatorMembershipError ? error.plan : undefined }, error.status);
  if (error instanceof CommercialMembershipError) return opsJson({ error: error.message }, error.status);
  if (error instanceof MembershipCheckoutConflictError && error.code === "membership_agreement_changed") return opsJson({ error: "The membership agreement changed. Review the current terms before accepting.", code: "review_changed" }, 409);
  if (error instanceof MembershipCheckoutConflictError) return opsJson({ error: "This member already has payment in progress, or their registration needs review. Check their billing status before starting another payment." }, 409);
  console.error("Operator membership checkout failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return opsJson({ error: "Membership payment is temporarily unavailable. Please try again." }, 503);
}
export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    const { memberId } = await context.params;
    if (!isUuid(memberId)) return opsJson({ error: "Member not found." }, 404);
    return opsJson(await operatorMembershipStatus(viewer.authUserId, memberId));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const access = await requireOpsMutationRequest(request);
    if ("response" in access) return access.response;
    const { memberId } = await context.params;
    if (!isUuid(memberId)) return opsJson({ error: "Member not found." }, 404);
    const raw = await request.text();
    if (raw.length > 1500) return opsJson({ error: "Request is too large." }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return opsJson({ error: "A valid payment request is required." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return opsJson({ error: "A valid payment request is required." }, 400);
    if (body.action === "quote") {
      if (Object.keys(body).some(key => !["action","requestId","plan"].includes(key)) || (typeof body.requestId !== "string" || !isUuid(body.requestId))
        || !isMembershipBillingPlan(body.plan)) return opsJson({ error: "Choose a membership plan." }, 400);
      return opsJson(await quoteOperatorMembership({ authUserId: access.viewer.authUserId, memberId, requestId: body.requestId, plan: body.plan }));
    }
    if (body.action !== "checkout" || Object.keys(body).some(key => !["action","reservationId","reviewToken","authorityAccepted","authorityVersion"].includes(key))
      || (typeof body.reservationId !== "string" || !isUuid(body.reservationId)) || typeof body.reviewToken !== "string" || !/^[a-f0-9]{64}$/.test(body.reviewToken)
      || body.authorityAccepted !== true || body.authorityVersion !== OPERATOR_MEMBERSHIP_AUTHORITY_VERSION) {
      return opsJson({ error: "Review the membership offer and confirm your authority to accept and pay for this member." }, 400);
    }
    return opsJson(await startOperatorMembershipCheckout({ authUserId: access.viewer.authUserId, memberId, reservationId: body.reservationId,
      reviewToken: body.reviewToken, authorityAccepted: true, authorityVersion: body.authorityVersion,
      applicationOrigin: getApplicationOrigin(new URL(request.url).origin), userAgent: request.headers.get("user-agent")?.slice(0,1000) ?? null }));
  } catch (error) { return failure(error); }
}
