import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getApplicationDatabase } from "@/lib/database/server";
import { acceptCoupleMembershipAuthorization, CommercialMembershipError, createCoupleMembershipAuthorization, getCoupleMembershipAuthorization } from "@/lib/membership/commercial-repository";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { PlatformAccessDeniedError, requireActivePlatformMemberLink } from "@/lib/platform/repository";
import { isUuid } from "@/lib/stripe/membership-state";
import { getApplicationOrigin, isTrustedCheckoutOrigin } from "@/lib/stripe/server";

export const runtime = "nodejs";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof PlatformAccessDeniedError) return response({ error: "Sign in with your registered member account." }, 403);
  if (error instanceof CommercialMembershipError) return response({ error: error.message }, error.status);
  console.error("Couples membership approval failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return response({ error: "This couples request is unavailable. Both adults need registered accounts and completed membership agreements." }, 409);
}

export async function GET(request: Request) {
  if (!isTrustedCheckoutOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return response({ error: "Sign in to view this request." }, 401);
    const platformUser = await requireActivePlatformMemberLink(viewer);
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return response({ error: "This request is unavailable." }, 404);
    const authorization = await getCoupleMembershipAuthorization(id);
    if (!authorization || authorization.revokedAt || authorization.expiresAt <= new Date() ||
      ![authorization.memberId, authorization.partnerMemberId].includes(platformUser.memberId)) {
      return response({ error: "This request is unavailable for this account." }, 404);
    }
    // Disclose the payer's chosen display name only to the targeted partner.
    const [payer] = await getApplicationDatabase()<Array<{ name: string }>>`
      select coalesce(nullif(btrim(profile.preferred_name), ''), nullif(btrim(profile.display_name), ''), 'Your partner') as name
      from ruined_members member join person_profiles profile on profile.person_id = member.person_id
      where member.id = ${authorization.memberId}::uuid`;
    return response({ authorization: { id, role: platformUser.memberId === authorization.memberId ? "payer" : "partner",
      payerName: payer?.name ?? "Your partner", accepted: Boolean(authorization.acceptedAt), expiresAt: authorization.expiresAt.toISOString() } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!isTrustedCheckoutOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return response({ error: "Sign in to manage your couples membership request." }, 401);
    if (!getPlatformConfiguration().stripeCheckoutReady) return response({ error: "Paid membership is not available yet." }, 503);
    const platformUser = await requireActivePlatformMemberLink(viewer);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "A valid couples request is required." }, 400);
    if (body.action === "accept") {
      if (!isUuid(body.authorizationId) || body.approved !== true || Object.keys(body).some(key => !["action", "authorizationId", "approved"].includes(key))) {
        return response({ error: "Confirm that you want to join this shared membership." }, 400);
      }
      await acceptCoupleMembershipAuthorization({ id: body.authorizationId, authUserId: viewer.authUserId });
      return response({ accepted: true });
    }
    if (body.action !== "request" || !isUuid(body.requestId) || typeof body.partnerTag !== "string" ||
      !/^[a-z0-9_]{3,24}$/.test(body.partnerTag) || Object.keys(body).some(key => !["action", "requestId", "partnerTag"].includes(key))) {
      return response({ error: "Enter your partner's member tag." }, 400);
    }
    const authorization = await getApplicationDatabase().begin(async tx => {
      await tx`select id from ruined_members where id = ${platformUser.memberId}::uuid for update`;
      const [rate] = await tx<Array<{ total: number }>>`select count(*)::integer as total from membership_couple_authorizations
        where payer_member_id = ${platformUser.memberId}::uuid and created_at > clock_timestamp() - interval '1 day'
          and id <> ${body.requestId}::uuid`;
      if (rate && rate.total >= 10) throw new CommercialMembershipError(429, "Wait before creating another couples request.");
      const [partner] = await tx<Array<{ id: string }>>`select member.id from person_profiles profile
        join ruined_members member on member.person_id = profile.person_id and member.deleted_at is null
        join member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state = 'active'
        where profile.member_tag = ${body.partnerTag} and member.id <> ${platformUser.memberId}::uuid limit 1`;
      if (!partner) throw new CommercialMembershipError(409, "Your partner needs to register and confirm their member tag before you can create this request.");
      return createCoupleMembershipAuthorization({ id: body.requestId, memberId: platformUser.memberId, partnerMemberId: partner.id }, tx);
    });
    const origin = getApplicationOrigin(new URL(request.url).origin);
    return response({ authorizationId: authorization.id, approvalUrl: `${origin}/my/couple?authorization=${authorization.id}` });
  } catch (error) { return failure(error); }
}
