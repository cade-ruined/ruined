import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  changeOpsAcademyCollectionState,
  saveOpsAcademyCollection,
} from "@/lib/platform/ops-academy-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CollectionBody = {
  action?: unknown;
  expectedRevision?: unknown;
  name?: unknown;
  position?: unknown;
  slug?: unknown;
  summary?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as CollectionBody | null;
  const { collectionId } = await params;
  try {
    const collection = await saveOpsAcademyCollection(access.viewer.authUserId, {
      collectionId,
      expectedRevision: typeof body?.expectedRevision === "number" ? body.expectedRevision : undefined,
      name: typeof body?.name === "string" ? body.name : "",
      position: typeof body?.position === "number" ? body.position : Number.NaN,
      slug: typeof body?.slug === "string" ? body.slug : "",
      summary: typeof body?.summary === "string" ? body.summary : "",
    });
    return opsJson({ collection });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Academy collection could not be saved", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Academy collection could not be saved." }, 503);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as CollectionBody | null;
  const { collectionId } = await params;
  const action = body?.action;
  if (action !== "publish" && action !== "unpublish" && action !== "retire") {
    return opsJson({ error: "Choose a valid collection state change." }, 400);
  }
  try {
    const collection = await changeOpsAcademyCollectionState(access.viewer.authUserId, {
      action,
      collectionId,
      expectedRevision: typeof body?.expectedRevision === "number" ? body.expectedRevision : Number.NaN,
    });
    return opsJson({ collection });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Academy collection state could not be changed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Academy collection state could not be changed." }, 503);
  }
}
