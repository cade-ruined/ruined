import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { getOpsSops, saveOpsSop } from "@/lib/platform/ops-sop-repository";
import { readSopInput, sopErrorResponse } from "./_request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return opsJson({ error: "Operator access is required." }, 401);
  try {
    return opsJson({ library: await getOpsSops(viewer.authUserId) });
  } catch (error) {
    return sopErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  try {
    const procedure = await saveOpsSop(access.viewer.authUserId, await readSopInput(request));
    return opsJson({ procedure }, 201);
  } catch (error) {
    return sopErrorResponse(error);
  }
}
