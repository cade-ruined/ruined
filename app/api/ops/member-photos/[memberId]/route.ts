import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { MemberPhotoError, MEMBER_PHOTO_RESPONSE_HEADERS } from "@/lib/membership/photo-policy";
import { getAuthorizedOperatorMemberPhoto } from "@/lib/membership/photos";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ memberId: string }> }) {
  const json = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: MEMBER_PHOTO_RESPONSE_HEADERS });
  if (getPlatformConfiguration().mode !== "connected") return json("Photo not found.", 404);
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json("Sign in to view this photo.", 401);
  try {
    const { memberId } = await context.params;
    const photo = await getAuthorizedOperatorMemberPhoto(viewer.authUserId, memberId);
    if (!photo) return json("Photo not found.", 404);
    return new Response(photo, {
      headers: { ...MEMBER_PHOTO_RESPONSE_HEADERS, "Content-Type": "image/webp", "Content-Disposition": "inline" },
    });
  } catch (error) {
    if (error instanceof MemberPhotoError) return json(error.message, error.status);
    console.error("Operator member photo could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return json("This photo is temporarily unavailable.", 503);
  }
}
