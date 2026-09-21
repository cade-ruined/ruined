import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { resolveCurrentPlatformSession } from "@/lib/auth/session";
import { MemberPhotoError, MEMBER_PHOTO_RESPONSE_HEADERS, readMemberPhotoFile } from "@/lib/membership/photo-policy";
import { deleteMemberPhoto, saveMemberPhoto } from "@/lib/membership/photos";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

async function mutate(request: Request, remove: boolean) {
  const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: MEMBER_PHOTO_RESPONSE_HEADERS });
  if (!isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  if (getPlatformConfiguration().mode !== "connected") return json({ error: "Photo uploads are not connected." }, 503);
  const session = await resolveCurrentPlatformSession();
  if (session.status === "unavailable") return json({ error: "Your connection could not be checked. Keep your photo open and try again." }, 503);
  if (session.status !== "authenticated") return json({ error: "Sign in to change your profile photo." }, 401);
  const expectedOwner = request.headers.get("X-Ruined-Session-Owner");
  if (expectedOwner !== null && expectedOwner.toLowerCase() !== session.viewer.authUserId.toLowerCase()) {
    return json({ error: "Your signed-in account changed. Reload before changing your photo." }, 409);
  }
  try {
    const result = remove
      ? await deleteMemberPhoto(session.viewer.authUserId)
      : await saveMemberPhoto(session.viewer.authUserId, await readMemberPhotoFile(request));
    return json(result);
  } catch (error) {
    if (error instanceof MemberPhotoError) return json({ error: error.message }, error.status);
    console.error("Member photo could not be saved", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: "Your photo could not be saved. Please try again." }, 500);
  }
}

export function POST(request: Request) { return mutate(request, false); }
export function DELETE(request: Request) { return mutate(request, true); }
