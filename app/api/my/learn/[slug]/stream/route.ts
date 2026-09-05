import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getMemberLearningResource } from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json(
      { error: "Member videos are not connected." },
      { status: 503 },
    );
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { error: "Passwordless member access is required." },
      { status: 401 },
    );
  }

  const { slug } = await context.params;
  const resource = await getMemberLearningResource(viewer.authUserId, slug);
  if (
    !resource ||
    resource.resourceType !== "video" ||
    !resource.storageBucket ||
    !resource.storagePath
  ) {
    return NextResponse.json(
      { error: "That member video is not available." },
      { status: 404 },
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Member video storage is unavailable." },
      { status: 503 },
    );
  }

  const { data, error } = await supabase.storage
    .from(resource.storageBucket)
    .createSignedUrl(resource.storagePath, 15 * 60);

  if (error || !data.signedUrl) {
    return NextResponse.json(
      { error: "That member video could not be opened." },
      { status: 502 },
    );
  }

  return NextResponse.redirect(data.signedUrl, 307);
}
