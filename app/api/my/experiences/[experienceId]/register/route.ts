import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  MembershipAccessDeniedError,
  MembershipConflictError,
  MembershipInputError,
  setMemberExperienceRegistration,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ experienceId: string }> },
) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "Experience registration is not connected." }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid registration action is required." }, { status: 400 });
  }
  const candidate = body as Record<string, unknown> | null;
  if (
    !candidate ||
    !["cancel", "register"].includes(String(candidate.action)) ||
    !Object.keys(candidate).every((key) => key === "action")
  ) {
    return NextResponse.json({ error: "That registration action is not valid." }, { status: 400 });
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Passwordless member access is required." }, { status: 401 });
  }
  try {
    const { experienceId } = await context.params;
    const registration = await setMemberExperienceRegistration(
      viewer.authUserId,
      experienceId,
      candidate.action as "cancel" | "register",
    );
    return NextResponse.json({ registration }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MembershipInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof MembershipConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof MembershipAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Experience registration failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Experience registration could not be saved." }, { status: 500 });
  }
}
