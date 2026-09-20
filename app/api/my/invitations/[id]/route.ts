import { handlePersonalInvitationRequest } from "@/lib/membership/personal-invitation-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handlePersonalInvitationRequest(request, (await context.params).id);
}
