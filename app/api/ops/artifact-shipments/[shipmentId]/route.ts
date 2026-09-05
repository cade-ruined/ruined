import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { updateOpsArtifactShipment } from "@/lib/platform/ops-artifact-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShipmentBody = {
  carrier?: unknown;
  changeReason?: unknown;
  expectedVersion?: unknown;
  serviceLevel?: unknown;
  status?: unknown;
  trackingNumber?: unknown;
  trackingUrl?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as ShipmentBody | null;
  const { shipmentId } = await params;
  try {
    const shipment = await updateOpsArtifactShipment({
      actorAuthUserId: access.viewer.authUserId,
      carrier: typeof body?.carrier === "string" ? body.carrier : "",
      changeReason: typeof body?.changeReason === "string" ? body.changeReason : "",
      expectedVersion: typeof body?.expectedVersion === "number" ? body.expectedVersion : Number.NaN,
      serviceLevel: typeof body?.serviceLevel === "string" ? body.serviceLevel : null,
      shipmentId,
      status: typeof body?.status === "string" ? body.status : "",
      trackingNumber: typeof body?.trackingNumber === "string" ? body.trackingNumber : "",
      trackingUrl: typeof body?.trackingUrl === "string" ? body.trackingUrl : null,
    });
    return opsJson({ shipment });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations Artifact shipment could not be updated", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The shipment could not be updated." }, 503);
  }
}
