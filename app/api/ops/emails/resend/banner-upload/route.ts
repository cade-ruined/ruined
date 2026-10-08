import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse } from "@/lib/communications/admin-email-api";
import { readAdminEmailImageUpload } from "@/lib/communications/admin-email-image-policy";
import { uploadAdminEmailImage } from "@/lib/communications/admin-email-images";
import { assertAdminEmailAccess } from "@/lib/communications/admin-email-repository";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { opsJson } from "@/lib/platform/ops-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (!isTrustedPlatformOrigin(request)) return opsJson({ error: "Request origin is not allowed." }, 403);
    if (getPlatformConfiguration().mode !== "connected") return opsJson({ error: "Photo uploads are unavailable in this preview." }, 503);
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    await assertAdminEmailAccess(viewer.authUserId);
    const file = await readAdminEmailImageUpload(request);
    return opsJson({ image: await uploadAdminEmailImage(viewer.authUserId, file) });
  } catch (error) { return adminEmailErrorResponse(error); }
}
