import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  getMemberLearningResource,
  MembershipAccessDeniedError,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
// Keep range requests valid for a full call, pauses, and later seeking.
const PLAYBACK_URL_SECONDS = 4 * 60 * 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json(
      { error: "Member videos are not connected." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { error: "Passwordless member access is required." },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const { slug } = await context.params;
  let resource;
  try {
    resource = await getMemberLearningResource(viewer.authUserId, slug);
  } catch (error) {
    if (!(error instanceof MembershipAccessDeniedError)) throw error;
    return NextResponse.json(
      { error: "That member video is not available." },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }
  if (
    !resource ||
    resource.resourceType !== "video" ||
    !resource.storageBucket ||
    !resource.storagePath
  ) {
    return NextResponse.json(
      { error: "That member video is not available." },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Member video storage is unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }

  const { data, error } = await supabase.storage
    .from(resource.storageBucket)
    .createSignedUrl(resource.storagePath, PLAYBACK_URL_SECONDS);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "That member video could not be opened." },
      { status: 502, headers: PRIVATE_HEADERS },
    );
  }

  return NextResponse.redirect(data.signedUrl, { status: 307, headers: PRIVATE_HEADERS });
}
