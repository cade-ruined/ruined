import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { createOpsArtifactTemplate } from "@/lib/platform/ops-artifact-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TemplateBody = {
  description?: unknown;
  livemode?: unknown;
  name?: unknown;
  productGid?: unknown;
  productHandle?: unknown;
  slug?: unknown;
};

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as TemplateBody | null;
  try {
    const template = await createOpsArtifactTemplate({
      actorAuthUserId: access.viewer.authUserId,
      description: typeof body?.description === "string" ? body.description : null,
      livemode: body?.livemode === true,
      name: typeof body?.name === "string" ? body.name : "",
      productGid: typeof body?.productGid === "string" ? body.productGid : "",
      productHandle: typeof body?.productHandle === "string" ? body.productHandle : "",
      slug: typeof body?.slug === "string" ? body.slug : "",
    });
    return opsJson({ template }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations Artifact template could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Artifact template could not be created." }, 503);
  }
}
