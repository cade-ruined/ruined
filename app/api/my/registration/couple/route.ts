import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { clearRegistrationCouple, getRegistrationCouple, RegistrationCoupleError, saveRegistrationCouple } from "@/lib/membership/registration-couple";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

function failure(error: unknown) {
  if (error instanceof RegistrationCoupleError) return json({ error: error.message }, error.status);
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "P4210") return json({ error: "This pair is already confirmed. Contact Ruined if it needs to change." }, 409);
  if (code === "P4206" || code === "P4211" || code === "21000") {
    return json({ error: "These registrations could not be linked. Contact Ruined for help with your Circle placement." }, 409);
  }
  if (code === "40001" || code === "40P01") return json({ error: "Your registration is being updated. Please try again." }, 409);
  if (code === "P4212") return json({ error: "Save your eligible personal information and verify your email before linking registrations." }, 403);
  console.error("Registration couple request failed", { code: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unavailable" });
  return json({ error: "Your couples registration could not be saved. Please try again." }, 503);
}

async function viewer() {
  if (getPlatformConfiguration().mode !== "connected") return { response: json({ error: "Registration is not connected." }, 503) };
  const current = await getCurrentPlatformViewer();
  return current ? { current } : { response: json({ error: "Verify your member email to continue." }, 401) };
}

export async function GET() {
  const access = await viewer();
  if (access.response) return access.response;
  try { return json({ couple: await getRegistrationCouple(access.current.authUserId) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON is required." }, 415);
  const access = await viewer();
  if (access.response) return access.response;
  const raw = await request.text();
  if (raw.length > 1_000) return json({ error: "That request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return json({ error: "Enter your partner’s email and confirm your choice." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Enter your partner’s email and confirm your choice." }, 400);
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !["partnerEmail", "consent"].includes(key)) || typeof body.partnerEmail !== "string" || body.consent !== true) {
    return json({ error: "Enter your partner’s email and confirm that you want to register together." }, 400);
  }
  try { return json({ couple: await saveRegistrationCouple(access.current.authUserId, body.partnerEmail) }); }
  catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  if (!isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const access = await viewer();
  if (access.response) return access.response;
  try { return json({ couple: await clearRegistrationCouple(access.current.authUserId) }); }
  catch (error) { return failure(error); }
}
