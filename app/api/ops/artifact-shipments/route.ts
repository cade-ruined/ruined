import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { createOpsArtifactShipment } from "@/lib/platform/ops-artifact-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShipmentBody = {
  artifactJobId?: unknown;
  carrier?: unknown;
  serviceLevel?: unknown;
  trackingNumber?: unknown;
  trackingUrl?: unknown;
};

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as ShipmentBody | null;
  try {
    const shipment = await createOpsArtifactShipment({
      actorAuthUserId: access.viewer.authUserId,
      artifactJobId: typeof body?.artifactJobId === "string" ? body.artifactJobId : "",
      carrier: typeof body?.carrier === "string" ? body.carrier : "",
      serviceLevel: typeof body?.serviceLevel === "string" ? body.serviceLevel : null,
      trackingNumber: typeof body?.trackingNumber === "string" ? body.trackingNumber : "",
      trackingUrl: typeof body?.trackingUrl === "string" ? body.trackingUrl : null,
    });
    return opsJson({ shipment }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations Artifact shipment could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The shipment could not be created." }, 503);
  }
}
