import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { getApplicationOrigin } from "@/lib/stripe/server";
import { isUuid } from "@/lib/stripe/membership-state";
import { OPERATOR_PAYMENT_SETUP_CONSENT_VERSION, PaymentMethodSetupError } from "@/lib/stripe/payment-method-model";
import { getOperatorMemberPaymentMethodStatus, startOperatorMemberPaymentMethodSetup } from "@/lib/stripe/payment-method-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ memberId: string }> };

function failure(error: unknown) {
  if (error instanceof PaymentMethodSetupError) return opsJson({ error: error.message }, error.status);
  console.error("Operator card setup failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return opsJson({ error: "Card setup is temporarily unavailable. Please try again." }, 503);
}

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    const { memberId } = await context.params;
    if (!isUuid(memberId)) return opsJson({ error: "Member not found." }, 404);
    // The service checks the current administrator grant in the database.
    return opsJson(await getOperatorMemberPaymentMethodStatus(viewer.authUserId, memberId));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const access = await requireOpsMutationRequest(request);
    if ("response" in access) return access.response;
    const { memberId } = await context.params;
    if (!isUuid(memberId)) return opsJson({ error: "Member not found." }, 404);
    const raw = await request.text();
    if (raw.length > 1000) return opsJson({ error: "Request is too large." }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return opsJson({ error: "A valid card setup request is required." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return opsJson({ error: "A valid card setup request is required." }, 400);
    }
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["attemptId", "consentAccepted", "consentVersion"].includes(key))
      || typeof input.attemptId !== "string" || !isUuid(input.attemptId)
      || input.consentAccepted !== true || input.consentVersion !== OPERATOR_PAYMENT_SETUP_CONSENT_VERSION) {
      return opsJson({ error: "Review the cardholder permission before continuing." }, 400);
    }
    return opsJson(await startOperatorMemberPaymentMethodSetup({
      authUserId: access.viewer.authUserId,
      memberId,
      attemptId: input.attemptId,
      consentAccepted: input.consentAccepted,
      consentVersion: input.consentVersion,
      applicationOrigin: getApplicationOrigin(new URL(request.url).origin),
    }));
  } catch (error) { return failure(error); }
}
