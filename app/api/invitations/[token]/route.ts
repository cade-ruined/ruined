import { NextResponse } from "next/server";
import { getPublicMemberInvitation } from "@/lib/membership/invitation-repository";
import { MEMBER_INVITATION_HEADERS } from "@/lib/membership/invitation-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const invitation = await getPublicMemberInvitation((await params).token);
    return NextResponse.json(invitation ? { invitation } : { error: "Invitation not found." }, { status: invitation ? 200 : 404, headers: MEMBER_INVITATION_HEADERS });
  } catch {
    return NextResponse.json({ error: "This invitation is temporarily unavailable." }, { status: 503, headers: MEMBER_INVITATION_HEADERS });
  }
}
