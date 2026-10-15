import { NextResponse } from "next/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getPublicMemberProfilePortrait } from "@/lib/membership/photos";
import { MEMBER_CARD_HEADERS } from "@/lib/membership/public-card-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ memberTag: string }> }) {
  const missing = () => NextResponse.json({ error: "Portrait not found." }, { status: 404, headers: MEMBER_CARD_HEADERS });
  if (getPlatformConfiguration().mode !== "connected") return missing();
  try {
    const { memberTag } = await context.params;
    const portrait = await getPublicMemberProfilePortrait(memberTag);
    if (!portrait) return missing();
    return new Response(portrait, { headers: { ...MEMBER_CARD_HEADERS, "Content-Type": "image/webp", "Content-Disposition": "inline" } });
  } catch (error) {
    console.error("Public profile portrait failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Portrait temporarily unavailable." }, { status: 503, headers: MEMBER_CARD_HEADERS });
  }
}
