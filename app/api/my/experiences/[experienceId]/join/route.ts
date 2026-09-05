import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  getMemberExperienceMeetingDestination,
  MembershipAccessDeniedError,
  MembershipInputError,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function unavailable(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ experienceId: string }> },
) {
  if (getPlatformConfiguration().mode !== "connected") {
    return unavailable("This Google Meet room is not connected.", 503);
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return unavailable("Passwordless member access is required.", 401);
  }

  try {
    const { experienceId } = await context.params;
    const destination = await getMemberExperienceMeetingDestination(
      viewer.authUserId,
      experienceId,
    );
    if (!destination) {
      return unavailable("This Google Meet room is not available.", 404);
    }
    return NextResponse.redirect(destination, {
      status: 303,
      headers: {
        ...NO_STORE_HEADERS,
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof MembershipInputError) {
      return unavailable(error.message, 400);
    }
    if (error instanceof MembershipAccessDeniedError) {
      return unavailable(error.message, 403);
    }
    console.error("Google Meet redirect failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return unavailable("This Google Meet room could not be opened.", 500);
  }
}
