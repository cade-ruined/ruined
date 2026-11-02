import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { PlatformAccessDeniedError } from "@/lib/platform/repository";
import { CommercialMembershipError } from "@/lib/membership/commercial-repository";
import { MembershipCheckoutConflictError } from "@/lib/stripe/billing-repository";
import { isUuid } from "@/lib/stripe/membership-state";
import { getApplicationOrigin } from "@/lib/stripe/server";
import { OperatorMembershipError, OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION } from "@/lib/stripe/operator-membership-model";
import { statusOperatorSavedMembership, quoteOperatorSavedMembership, startOperatorSavedMembership } from "@/lib/stripe/operator-saved-payment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ memberId: string }> };

function failure(error: unknown) {
  if (error instanceof PlatformAccessDeniedError) return opsJson({ error: "Administrator access is required." }, 403);
  if (error instanceof OperatorMembershipError) return opsJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof CommercialMembershipError) return opsJson({ error: error.message }, error.status);
  if (error instanceof MembershipCheckoutConflictError) return opsJson({ error: "This payment needs review. Check the member’s billing before starting another payment." }, 409);
  console.error("Operator saved membership collection failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return opsJson({ error: "The payment could not be confirmed. Check billing before trying again." }, 503);
}

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    const { memberId } = await context.params;
    if (!isUuid(memberId)) return opsJson({ error: "Member not found." }, 404);
    return opsJson(await statusOperatorSavedMembership(viewer.authUserId, memberId));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const access = await requireOpsMutationRequest(request);
    if ("response" in access) return access.response;
    const { memberId } = await context.params;
    if (!isUuid(memberId)) return opsJson({ error: "Member not found." }, 404);
    const raw = await request.text();
    if (raw.length > 4000) return opsJson({ error: "Request is too large." }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return opsJson({ error: "A valid payment request is required." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return opsJson({ error: "A valid payment request is required." }, 400);
    if (body.action === "quote") {
      if (Object.keys(body).some(key => !["action", "requestId"].includes(key)) || typeof body.requestId !== "string" || !isUuid(body.requestId)) {
        return opsJson({ error: "Review the member’s payment first." }, 400);
      }
      return opsJson(await quoteOperatorSavedMembership({ authUserId: access.viewer.authUserId, memberId, requestId: body.requestId, plan: "monthly" }));
    }
    if (body.action !== "collect" || Object.keys(body).some(key => !["action", "reservationId", "reviewToken", "authorityAccepted", "authorityVersion", "authorizationEvidence"].includes(key))
      || typeof body.reservationId !== "string" || !isUuid(body.reservationId)
      || typeof body.reviewToken !== "string" || !/^[a-f0-9]{64}$/.test(body.reviewToken)
      || body.authorityAccepted !== true || body.authorityVersion !== OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION
      || typeof body.authorizationEvidence !== "string" || body.authorizationEvidence.trim().length < 20 || body.authorizationEvidence.length > 1500) {
      return opsJson({ error: "Review the price and record the member’s authorization for the agreement, first payment, and renewals." }, 400);
    }
    return opsJson(await startOperatorSavedMembership({ authUserId: access.viewer.authUserId, memberId,
      reservationId: body.reservationId, reviewToken: body.reviewToken, authorityAccepted: true,
      authorityVersion: body.authorityVersion, authorizationEvidence: body.authorizationEvidence.trim(),
      applicationOrigin: getApplicationOrigin(new URL(request.url).origin), userAgent: request.headers.get("user-agent")?.slice(0, 1000) ?? null }));
  } catch (error) { return failure(error); }
}
