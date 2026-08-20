import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { confirmCommunicationSubscription } from "@/lib/communications/repository";

export const runtime = "nodejs";

const MAX_BODY_LENGTH = 2_048;
const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 512;

type RedirectStatus =
  | "confirmed"
  | "already_confirmed"
  | "invalid"
  | "expired"
  | "unavailable";

function redirectWithStatus(request: Request, status: RedirectStatus) {
  const destination = new URL("/communications/confirm", request.url);
  destination.searchParams.set("status", status);
  return NextResponse.redirect(destination, 303);
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "Form submission required" }, { status: 415 });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Submission too large" }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid submission" }, { status: 400 });
  }

  if (rawBody.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Submission too large" }, { status: 413 });
  }

  const form = new URLSearchParams(rawBody);
  const tokenValues = form.getAll("token");
  const token = tokenValues.length === 1 ? tokenValues[0]?.trim() ?? "" : "";

  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    return redirectWithStatus(request, "invalid");
  }

  try {
    const status = await confirmCommunicationSubscription(token);
    return redirectWithStatus(request, status);
  } catch (error) {
    const details = error && typeof error === "object"
      ? {
          code: "code" in error ? String(error.code) : undefined,
          name: "name" in error ? String(error.name) : undefined,
        }
      : undefined;
    console.error("Communication confirmation failed.", details);
    return redirectWithStatus(request, "unavailable");
  }
}
