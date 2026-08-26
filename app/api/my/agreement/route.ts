import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  acceptPublishedMembershipAgreement,
  MembershipAccessDeniedError,
  MembershipConflictError,
  MembershipInputError,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { processWorkflowBatch } from "@/lib/workflows/worker";

export const runtime = "nodejs";

type AgreementAction = {
  affirmativeAction: "checkbox_and_submit";
  ageConfirmed: true;
  agreementVersionId: string;
  attemptId: string;
  signerName: string;
};

function isAgreementAction(value: unknown): value is AgreementAction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.affirmativeAction === "checkbox_and_submit" &&
    candidate.ageConfirmed === true &&
    typeof candidate.agreementVersionId === "string" &&
    typeof candidate.attemptId === "string" &&
    typeof candidate.signerName === "string" &&
    Object.keys(candidate).every((key) =>
      [
        "affirmativeAction",
        "ageConfirmed",
        "agreementVersionId",
        "attemptId",
        "signerName",
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
  console.error("Membership agreement acceptance failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    { error: "The agreement could not be recorded." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  const configuration = getPlatformConfiguration();
  if (configuration.mode !== "connected") {
    return NextResponse.json({ error: "Membership entry is not connected." }, { status: 503 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "JSON is required." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return NextResponse.json({ error: "That request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid agreement action is required." }, { status: 400 });
  }
  if (!isAgreementAction(body)) {
    return NextResponse.json({ error: "That agreement action is not supported." }, { status: 400 });
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Passwordless member access is required." }, { status: 401 });
  }

  try {
    const result = await acceptPublishedMembershipAgreement(viewer.authUserId, {
      ...body,
      evidence: {
        origin: request.headers.get("origin"),
        userAgent: request.headers.get("user-agent"),
      },
      minimumAge: configuration.minimumAge,
    });
    try {
      await processWorkflowBatch(4);
    } catch (workflowError) {
      // Acceptance is already durable. The scheduled worker will recover the
      // receipt job if this best-effort pass cannot run now.
      console.error("Agreement receipt follow-up could not run", {
        errorType: workflowError instanceof Error ? workflowError.name : "UnknownError",
      });
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
