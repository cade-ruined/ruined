import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  getMemberCircleChatDestination,
  MembershipAccessDeniedError,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function unavailable(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function GET() {
  if (getPlatformConfiguration().mode !== "connected") {
    return unavailable("Circle Chat is not connected.", 503);
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return unavailable("Passwordless member access is required.", 401);
  }

  try {
    const destination = await getMemberCircleChatDestination(viewer.authUserId);
    if (!destination) {
      return unavailable("Circle Chat is not available for this Circle.", 404);
    }
    return NextResponse.redirect(destination, {
      status: 303,
      headers: {
        ...NO_STORE_HEADERS,
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof MembershipAccessDeniedError) {
      return unavailable(error.message, 403);
    }
    console.error("Circle Chat redirect failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return unavailable("Circle Chat could not be opened.", 500);
  }
}
