import { after } from "next/server";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { activateMemberRegistration, getOpsMemberRegistration, MemberRegistrationError } from "@/lib/membership/registration-repository";
import { processRegistrationMessageBatch } from "@/lib/membership/registration-message-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ memberId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: unknown) {
  if (error instanceof MemberRegistrationError) return opsJson({ error: error.message }, error.status);
  console.error("Registration management failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return opsJson({ error: "Registration could not be updated. Refresh before trying again." }, 503);
}

export async function GET(_request: Request, context: Context) {
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
  const { memberId } = await context.params;
  if (!uuid.test(memberId)) return opsJson({ error: "Member not found." }, 404);
  try { return opsJson({ registration: await getOpsMemberRegistration(viewer.authUserId, memberId) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const { memberId } = await context.params;
  if (!uuid.test(memberId)) return opsJson({ error: "Member not found." }, 404);
  const raw = await request.text();
  if (raw.length > 1000) return opsJson({ error: "Request is too large." }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return opsJson({ error: "A valid activation request is required." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return opsJson({ error: "A valid activation request is required." }, 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !["action", "expectedVersion"].includes(key)) || input.action !== "activate_profile"
    || !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) {
    return opsJson({ error: "Review the current registration before opening this profile." }, 400);
  }
  try {
    const registration = await activateMemberRegistration(access.viewer.authUserId, memberId, input.expectedVersion as number);
    // Profile release and its email are already committed together. Delivery can
    // retry independently without repeating the permission change.
    after(async () => {
      try { await processRegistrationMessageBatch(2, { memberId }); }
      catch (error) { console.error("Registration email delivery deferred", { errorType: error instanceof Error ? error.name : "UnknownError" }); }
    });
    return opsJson({ registration });
  } catch (error) { return failure(error); }
}
