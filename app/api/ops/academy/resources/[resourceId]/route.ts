import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  saveOpsAcademyResource,
  type OpsAcademyResourceInput,
} from "@/lib/platform/ops-academy-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResourceBody = Partial<Record<keyof OpsAcademyResourceInput, unknown>>;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as ResourceBody | null;
  const { resourceId } = await params;
  const audiences: OpsAcademyResourceInput["audiences"] = [];
  if (Array.isArray(body?.audiences)) {
    for (const entry of body.audiences) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const value = entry as { id?: unknown; kind?: unknown };
      if (value.kind !== "all_members" && value.kind !== "circle" && value.kind !== "block") continue;
      audiences.push({ id: typeof value.id === "string" ? value.id : null, kind: value.kind });
    }
  }
  try {
    const resource = await saveOpsAcademyResource(access.viewer.authUserId, {
      audiences,
      bodyText: typeof body?.bodyText === "string" ? body.bodyText : "",
      captionsUrl: typeof body?.captionsUrl === "string" ? body.captionsUrl : "",
      collectionId: typeof body?.collectionId === "string" ? body.collectionId : "",
      contentType: typeof body?.contentType === "string" ? body.contentType : "",
      durationLabel: typeof body?.durationLabel === "string" ? body.durationLabel : "",
      expectedRevision: typeof body?.expectedRevision === "number" ? body.expectedRevision : undefined,
      externalUrl: typeof body?.externalUrl === "string" ? body.externalUrl : "",
      featured: body?.featured === true,
      position: typeof body?.position === "number" ? body.position : Number.NaN,
      presenter: typeof body?.presenter === "string" ? body.presenter : "",
      resourceId,
      slug: typeof body?.slug === "string" ? body.slug : "",
      summary: typeof body?.summary === "string" ? body.summary : "",
      thumbnailUrl: typeof body?.thumbnailUrl === "string" ? body.thumbnailUrl : "",
      title: typeof body?.title === "string" ? body.title : "",
      videoUrl: typeof body?.videoUrl === "string" ? body.videoUrl : "",
    });
    return opsJson({ resource });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Academy draft could not be saved", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Academy draft could not be saved." }, 503);
  }
}
