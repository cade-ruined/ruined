import { handlePersonalInvitationRequest } from "@/lib/membership/personal-invitation-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) { return handlePersonalInvitationRequest(request); }
export async function POST(request: Request) { return handlePersonalInvitationRequest(request); }
