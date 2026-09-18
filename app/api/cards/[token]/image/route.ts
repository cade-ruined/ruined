import { MEMBER_CARD_HEADERS } from "@/lib/membership/public-card-model";
import { getPublicMemberCard, getPublicMemberCardPortrait } from "@/lib/membership/public-card-repository";
import { renderPublicMemberCardImage } from "@/lib/membership/public-card-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unavailable = (status: number) => new Response("Card unavailable.", { status, headers: MEMBER_CARD_HEADERS });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const card = await getPublicMemberCard(token);
    if (!card) return unavailable(404);
    const portrait = card.avatarUrl ? await getPublicMemberCardPortrait(token) : null;
    const image = await renderPublicMemberCardImage(card, portrait);
    const current = await getPublicMemberCard(token);
    if (!current || JSON.stringify(current) !== JSON.stringify(card)) return unavailable(404);
    return new Response(image, {
      headers: { ...MEMBER_CARD_HEADERS, "Content-Type": "image/png", "Content-Disposition": "inline" },
    });
  } catch (error) {
    // Do not expose a token, member detail, storage path, or renderer error.
    return unavailable(error && typeof error === "object" && "status" in error && error.status === 404 ? 404 : 503);
  }
}
