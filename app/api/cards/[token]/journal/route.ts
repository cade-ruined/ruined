import { NextResponse } from "next/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getPublicJournal } from "@/lib/membership/public-journal-repository";
import { JournalError } from "@/lib/membership/journal-model";
import { MEMBER_CARD_HEADERS } from "@/lib/membership/public-card-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const missing = () => NextResponse.json({ error: "Journal not found." }, { status: 404, headers: MEMBER_CARD_HEADERS });
  if (getPlatformConfiguration().mode !== "connected") return missing();
  try {
    const { token } = await context.params;
    const page = await getPublicJournal(token, new URL(request.url).searchParams.get("before"));
    return page ? NextResponse.json(page, { headers: MEMBER_CARD_HEADERS }) : missing();
  } catch (error) {
    const status = error instanceof JournalError ? error.status : 503;
    return NextResponse.json({ error: status === 400 ? "Invalid journal page." : "Journal temporarily unavailable." }, { status, headers: MEMBER_CARD_HEADERS });
  }
}
