import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  completeMemberAdministrativeOnboarding,
  MembershipAccessDeniedError,
  MembershipConflictError,
  MembershipInputError,
  saveMemberOnboardingProfile,
  type MemberOnboardingProfileInput,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { processWorkflowBatch } from "@/lib/workflows/worker";

export const runtime = "nodejs";

type OnboardingAction =
  | { action: "complete" }
  | ({ action: "save_profile" } & MemberOnboardingProfileInput);

function isAddress(value: unknown): value is MemberOnboardingProfileInput["shippingAddress"] {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.addressLine1 === "string" &&
    (candidate.addressLine2 === null || typeof candidate.addressLine2 === "string") &&
    typeof candidate.city === "string" &&
    typeof candidate.countryCode === "string" &&
    typeof candidate.postalCode === "string" &&
    typeof candidate.region === "string" &&
    Object.keys(candidate).every((key) =>
      ["addressLine1", "addressLine2", "city", "countryCode", "postalCode", "region"].includes(key),
    )
  );
}

function isOnboardingAction(value: unknown): value is OnboardingAction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.action === "complete") {
    return Object.keys(candidate).every((key) => key === "action");
  }
  return (
    candidate.action === "save_profile" &&
    typeof candidate.apparelTopSize === "string" &&
    typeof candidate.birthDate === "string" &&
    typeof candidate.legalName === "string" &&
    typeof candidate.mobile === "string" &&
    typeof candidate.preferredName === "string" &&
    isAddress(candidate.shippingAddress) &&
    Object.keys(candidate).every((key) =>
      [
        "action",
        "apparelTopSize",
        "birthDate",
        "legalName",
        "mobile",
        "preferredName",
        "shippingAddress",
      ].includes(key),
    )
  );
}

function errorResponse(error: unknown) {
  if (error instanceof MembershipInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof MembershipConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof MembershipAccessDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  console.error("Member onboarding action failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json({ error: "Membership entry could not be saved." }, { status: 500 });
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "Membership entry is not connected." }, { status: 503 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "JSON is required." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 12_000) {
    return NextResponse.json({ error: "That request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid onboarding action is required." }, { status: 400 });
  }
  if (!isOnboardingAction(body)) {
    return NextResponse.json({ error: "That onboarding action is not supported." }, { status: 400 });
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Passwordless member access is required." }, { status: 401 });
  }

  try {
    const onboarding =
      body.action === "complete"
        ? await completeMemberAdministrativeOnboarding(viewer.authUserId)
        : await saveMemberOnboardingProfile(viewer.authUserId, body);
    if (body.action === "complete") {
      try {
        await processWorkflowBatch(8);
      } catch (workflowError) {
        console.error("Onboarding completion follow-up could not run", {
          errorType: workflowError instanceof Error ? workflowError.name : "UnknownError",
        });
      }
    }
    return NextResponse.json(
      { onboarding },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
