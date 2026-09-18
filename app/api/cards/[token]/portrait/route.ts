import { NextResponse } from "next/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getPublicMemberCardPortrait } from "@/lib/membership/public-card-repository";
import { MEMBER_CARD_HEADERS } from "@/lib/membership/public-card-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const missing = () => NextResponse.json({ error: "Portrait not found." }, { status: 404, headers: MEMBER_CARD_HEADERS });
  if (getPlatformConfiguration().mode !== "connected") return missing();
  try {
    const { token } = await context.params;
    const portrait = await getPublicMemberCardPortrait(token);
    if (!portrait) return missing();
    return new Response(portrait, { headers: { ...MEMBER_CARD_HEADERS, "Content-Type": "image/webp", "Content-Disposition": "inline" } });
  } catch (error) {
    console.error("Public member portrait failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Portrait temporarily unavailable." }, { status: 503, headers: MEMBER_CARD_HEADERS });
  }
}
