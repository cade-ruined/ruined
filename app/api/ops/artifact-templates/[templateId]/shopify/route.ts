import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { bindOpsArtifactTemplate } from "@/lib/platform/ops-artifact-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import { verifyArtifactShopifySelection } from "@/lib/platform/ops-artifact-products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BindingBody = { livemode?: unknown; productGid?: unknown; productHandle?: unknown };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as BindingBody | null;
  const { templateId } = await params;
  try {
    const product = await verifyArtifactShopifySelection(access.viewer.authUserId, body?.productGid, body?.productHandle);
    const binding = await bindOpsArtifactTemplate({
      actorAuthUserId: access.viewer.authUserId,
      livemode: body?.livemode === true,
      productGid: product.id,
      productHandle: product.handle,
      templateId,
    });
    return opsJson({ binding });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations Shopify Artifact binding could not be updated", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Shopify binding could not be updated." }, 503);
  }
}
