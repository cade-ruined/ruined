import { NextResponse } from "next/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getPublicJournalMedia } from "@/lib/membership/public-journal-repository";
import { MEMBER_CARD_HEADERS } from "@/lib/membership/public-card-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(_request: Request, context: { params: Promise<{ token: string; id: string }> }) {
  const missing = () => NextResponse.json({ error: "Media not found." }, { status: 404, headers: MEMBER_CARD_HEADERS });
  if (getPlatformConfiguration().mode !== "connected") return missing();
  try {
    const { token, id } = await context.params;
    const media = await getPublicJournalMedia(token, id);
    if (!media) return missing();
    return new Response(media.data, { headers: { ...MEMBER_CARD_HEADERS, "Content-Type": media.mimeType,
      "Content-Disposition": "inline", "Referrer-Policy": "no-referrer" } });
  } catch {
    return NextResponse.json({ error: "Media temporarily unavailable." }, { status: 503, headers: MEMBER_CARD_HEADERS });
  }
}
