import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export function opsJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function requireOpsMutationRequest(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return { response: opsJson({ error: "Request origin is not allowed." }, 403) } as const;
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return { response: opsJson({ error: "Operator account access is required." }, 401) } as const;
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { response: opsJson({ error: "JSON is required." }, 415) } as const;
  }
  return { viewer } as const;
}

export function opsRepositoryErrorResponse(error: OpsOperatingRepositoryError) {
  const status = error.code === "forbidden"
    ? 403
    : error.code === "not_found"
      ? 404
      : error.code === "conflict"
        ? 409
        : 400;
  return opsJson({ error: error.message }, status);
}
