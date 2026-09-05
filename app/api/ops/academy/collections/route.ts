import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { saveOpsAcademyCollection } from "@/lib/platform/ops-academy-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CollectionBody = {
  name?: unknown;
  position?: unknown;
  slug?: unknown;
  summary?: unknown;
};

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as CollectionBody | null;
  try {
    const collection = await saveOpsAcademyCollection(access.viewer.authUserId, {
      name: typeof body?.name === "string" ? body.name : "",
      position: typeof body?.position === "number" ? body.position : Number.NaN,
      slug: typeof body?.slug === "string" ? body.slug : "",
      summary: typeof body?.summary === "string" ? body.summary : "",
    });
    return opsJson({ collection }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Academy collection could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Academy collection could not be created." }, 503);
  }
}
