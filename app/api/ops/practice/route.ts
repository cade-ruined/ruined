import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { AdminEmailError } from "@/lib/communications/admin-email-model";
import { opsJson } from "@/lib/platform/ops-api";
import { getPracticeReleaseOverview, reviewPracticeRelease, releasePracticeAssignment, reviewPracticeDeckRelease, releasePracticeDeck } from "@/lib/practice/release-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET() {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    return opsJson(await getPracticeReleaseOverview(viewer.authUserId));
  } catch (error) { return adminEmailErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const access = await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    const body = await readAdminEmailJson(request);
    if (body.action === "review_deck" && Object.keys(body).every(k => ["action", "course"].includes(k))) return opsJson(await reviewPracticeDeckRelease(access.viewer.authUserId, body.course));
    if (body.action === "release_deck" && Object.keys(body).every(k => ["action", "reviewToken"].includes(k))) return opsJson(await releasePracticeDeck(access.viewer.authUserId, body.reviewToken));
    if (body.action === "review" && Object.keys(body).every(k => ["action", "course"].includes(k))) return opsJson(await reviewPracticeRelease(access.viewer.authUserId, body.course));
    if (body.action === "release" && Object.keys(body).every(k => ["action", "reviewToken"].includes(k))) return opsJson(await releasePracticeAssignment(access.viewer.authUserId, body.reviewToken));
    throw new AdminEmailError(400, "Review the recap and audience before releasing the assignment.");
  } catch (error) { return adminEmailErrorResponse(error); }
}
