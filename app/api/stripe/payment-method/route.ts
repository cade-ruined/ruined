import { NextResponse } from "next/server";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getApplicationOrigin, isTrustedCheckoutOrigin } from "@/lib/stripe/server";
import { PaymentMethodSetupError } from "@/lib/stripe/payment-method-model";
import { getMemberPaymentMethodStatus, startMemberPaymentMethodSetup, withdrawMemberPaymentMethod } from "@/lib/stripe/payment-method-service";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
function response(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }); }
function failure(error: unknown) {
  if (error instanceof PaymentMethodSetupError) return response({ error: error.message }, error.status);
  return response({ error: "Payment setup is temporarily unavailable. Please try again." }, 503);
}
export async function GET() {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return response({ error: "Sign in to continue." }, 401);
    return response(await getMemberPaymentMethodStatus(viewer.authUserId));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isTrustedCheckoutOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return response({ error: "Sign in to continue." }, 401);
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return response({ error: "A valid setup request is required." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "A valid setup request is required." }, 400);
    return response(await startMemberPaymentMethodSetup({ authUserId: viewer.authUserId, attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      consentAccepted: body.consentAccepted, consentVersion: body.consentVersion, applicationOrigin: getApplicationOrigin(new URL(request.url).origin) }));
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  if (!isTrustedCheckoutOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return response({ error: "Sign in to continue." }, 401);
    let body: { confirmation?: unknown };
    try { body = await request.json(); } catch { return response({ error: "Confirm removal before continuing." }, 400); }
    if (body?.confirmation !== true) return response({ error: "Confirm removal before continuing." }, 400);
    return response(await withdrawMemberPaymentMethod(viewer.authUserId));
  } catch (error) { return failure(error); }
}
