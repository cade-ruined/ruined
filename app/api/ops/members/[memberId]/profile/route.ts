import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import { updateOpsMemberProfileSupport } from "@/lib/platform/ops-profile-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileBody = Record<string, unknown>;

function optionalStringValue(body: ProfileBody | null, key: string): string | undefined {
  if (!body || !Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  if (typeof body[key] !== "string") {
    throw new OpsOperatingRepositoryError("invalid_request", `${key} must be text.`);
  }
  return body[key] as string;
}

function requiredStringValue(body: ProfileBody | null, key: string): string {
  return optionalStringValue(body, key) ?? "";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as ProfileBody | null;
  const { memberId } = await params;
  try {
    const profile = await updateOpsMemberProfileSupport({
      accessibilityNotes: optionalStringValue(body, "accessibilityNotes"),
      actorAuthUserId: access.viewer.authUserId,
      addressLine1: optionalStringValue(body, "addressLine1"),
      addressLine2: optionalStringValue(body, "addressLine2"),
      apparelTopSize: optionalStringValue(body, "apparelTopSize"),
      bio: optionalStringValue(body, "bio"),
      buildingNow: optionalStringValue(body, "buildingNow"),
      city: optionalStringValue(body, "city"),
      countryCode: optionalStringValue(body, "countryCode"),
      displayName: optionalStringValue(body, "displayName"),
      expectedVersion: requiredStringValue(body, "expectedVersion"),
      legalName: optionalStringValue(body, "legalName"),
      location: optionalStringValue(body, "location"),
      memberId,
      mobile: optionalStringValue(body, "mobile"),
      postalCode: optionalStringValue(body, "postalCode"),
      preferredName: optionalStringValue(body, "preferredName"),
      reason: requiredStringValue(body, "reason"),
      region: optionalStringValue(body, "region"),
      timezone: optionalStringValue(body, "timezone"),
    });
    return opsJson({ profile });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations member profile support could not be saved", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The member profile could not be updated." }, 503);
  }
}
