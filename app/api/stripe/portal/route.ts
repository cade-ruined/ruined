import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { ensurePlatformMemberForViewer } from "@/lib/platform/repository";
import { createBillingPortalSessionForMember } from "@/lib/stripe/portal";
import { getApplicationOrigin } from "@/lib/stripe/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  const configuration = getPlatformConfiguration();
  if (configuration.mode !== "connected" || configuration.stripe !== "connected") {
    return NextResponse.json({ error: "Stripe billing is not configured yet." }, { status: 503 });
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Passwordless account access is required." }, { status: 401 });
  }

  try {
    const platformUser = await ensurePlatformMemberForViewer(viewer);
    const origin = getApplicationOrigin(new URL(request.url).origin);
    const portalUrl = await createBillingPortalSessionForMember({
      memberId: platformUser.memberId,
      returnUrl: `${origin}/my/account`,
    });
    return NextResponse.redirect(portalUrl, 303);
  } catch (error) {
    console.error("Stripe billing Portal could not be opened", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Billing management is temporarily unavailable." }, { status: 502 });
  }
}
