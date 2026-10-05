import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { getOpsSop, saveOpsSop } from "@/lib/platform/ops-sop-repository";
import { readSopInput, sopErrorResponse } from "../_request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ sopId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return opsJson({ error: "Operator access is required." }, 401);
  try {
    return opsJson({ editor: await getOpsSop(viewer.authUserId, (await params).sopId) });
  } catch (error) {
    return sopErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  try {
    const input = await readSopInput(request, (await params).sopId);
    return opsJson({ procedure: await saveOpsSop(access.viewer.authUserId, input) });
  } catch (error) {
    return sopErrorResponse(error);
  }
}
