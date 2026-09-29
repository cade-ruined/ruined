import { NextResponse, type NextRequest } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { PlatformAccessDeniedError, requireActivePlatformMemberLink } from "@/lib/platform/repository";
import { getMemberBillingCommitment } from "@/lib/stripe/commitment-account";
import { MembershipCommitmentError } from "@/lib/stripe/commitment-policy";
import { confirmMemberCancellation, createMemberCancellationQuote } from "@/lib/stripe/cancellation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function member() {
  if (getPlatformConfiguration().mode !== "connected") throw new MembershipCommitmentError("billing_unavailable");
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) throw new MembershipCommitmentError("sign_in_required");
  return requireActivePlatformMemberLink(viewer);
}

function failure(error: unknown) {
  if (error instanceof PlatformAccessDeniedError) return reply({ error: "Member account access is required." }, 403);
  if (error instanceof MembershipCommitmentError) {
    if (error.code === "sign_in_required") return reply({ error: "Sign in to manage your membership." }, 401);
    const review = /review|invoice|reconciliation/.test(error.code);
    return reply({ code: error.code, error: review
      ? "Your early-exit balance needs a billing review. Contact support; you can still turn off renewal here without a fee."
      : error.code === "cancellation_in_progress" || error.code === "cancellation_already_pending"
        ? "A cancellation request is already being processed. Please try again shortly."
        : "Your billing details changed or this confirmation expired. Review a fresh cancellation quote." }, 409);
  }
  console.error("Membership cancellation unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return reply({ error: "Billing could not be reached. Your request may still be processing; retry this confirmation or contact support." }, 502);
}

export async function GET() {
  try {
    const identity = await member(), contract = await getMemberBillingCommitment(identity.memberId);
    return reply({ commitment: contract ? { initialTermEndsAt: contract.initialTermEndsAt, plan: contract.billingPlan } : null });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  if (!isTrustedPlatformOrigin(request)) return reply({ error: "Request origin is not allowed." }, 403);
  try {
    const body = await request.json().catch(() => null);
    if (!body || !["quote", "confirm"].includes(body.action)) return reply({ error: "Choose a cancellation action." }, 400);
    const identity = await member();
    if (body.action === "quote") {
      if (!["disable_renewal", "early_exit"].includes(body.intent)) return reply({ error: "Choose a cancellation option." }, 400);
      return reply({ quote: await createMemberCancellationQuote(identity.memberId, body.intent) });
    }
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.quoteId ?? "")
      || body.confirmed !== true) return reply({ error: "Confirm the displayed cancellation terms." }, 400);
    return reply({ cancellation: await confirmMemberCancellation(identity.memberId, body.quoteId) });
  } catch (error) { return failure(error); }
}
