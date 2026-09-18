import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOwnMemberCard, saveOwnMemberCard } from "@/lib/membership/public-card-repository";
import { MEMBER_CARD_HEADERS, PublicCardError, readMemberCardJson, validateMemberCardInput } from "@/lib/membership/public-card-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { ...MEMBER_CARD_HEADERS, Vary: "Cookie" };
async function viewer(request: Request, write = false) {
  if (write && !isTrustedPlatformOrigin(request)) throw new PublicCardError(403, "Request origin is not allowed.");
  if (getPlatformConfiguration().mode !== "connected") throw new PublicCardError(503, "Your member card is not connected.");
  const current = await getCurrentPlatformViewer();
  if (!current) throw new PublicCardError(401, "Sign in to open your member card.");
  return current.authUserId;
}
function failure(error: unknown) {
  if (error instanceof PublicCardError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error("Member card request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "Your member card is temporarily unavailable. Your changes have not been cleared." }, { status: 503, headers });
}
export async function GET(request: Request) {
  try { return NextResponse.json({ snapshot: await getOwnMemberCard(await viewer(request)) }, { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const authUserId = await viewer(request, true);
    const input = validateMemberCardInput(await readMemberCardJson(request));
    return NextResponse.json({ snapshot: await saveOwnMemberCard(authUserId, input) }, { headers });
  } catch (error) { return failure(error); }
}
