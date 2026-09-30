import { getPlatformConfiguration } from "@/lib/platform/config";
import { renderRegistrationInvitationHero } from "@/lib/membership/registration-invitation-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local fictional artwork only. Real invitation images travel inside their email. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || getPlatformConfiguration().mode !== "preview") {
    return new Response("Not found", { status: 404 });
  }
  const memberInvite = new URL(request.url).searchParams.get("source") === "member";
  const image = await renderRegistrationInvitationHero({
    recipientName: "Alex Rivera",
    inviterName: memberInvite ? "Cade Mangelson" : "The Ruined Project",
    inviterTag: memberInvite ? "cade" : null,
    invitationSource: memberInvite ? "member" : "ruined_direct",
    issuedAt: "2026-09-30T18:00:00Z",
    expiresAt: "2026-10-02T18:00:00Z",
    wearSeed: "registration-email-fictional-preview",
  });
  return new Response(new Uint8Array(image), { headers: {
    "Content-Type": "image/jpeg",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  } });
}
