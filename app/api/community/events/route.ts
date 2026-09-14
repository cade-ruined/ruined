import { NextResponse } from "next/server";
import { getPublicCommunityEvents } from "@/lib/events/community-event-repository";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const events = await getPublicCommunityEvents();
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Public event listings unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Events are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
