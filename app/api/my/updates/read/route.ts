import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  markMemberNotificationRead,
  MembershipAccessDeniedError,
  MembershipInputError,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "Member updates are not connected." }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid update is required." }, { status: 400 });
  }
  const candidate = body as Record<string, unknown> | null;
  if (
    !candidate ||
    typeof candidate.notificationId !== "string" ||
    !Object.keys(candidate).every((key) => key === "notificationId")
  ) {
    return NextResponse.json({ error: "That update is not valid." }, { status: 400 });
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Passwordless member access is required." }, { status: 401 });
  }
  try {
    await markMemberNotificationRead(viewer.authUserId, candidate.notificationId);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MembershipInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof MembershipAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Member notification could not be marked read", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "That update could not be marked read." }, { status: 500 });
  }
}
