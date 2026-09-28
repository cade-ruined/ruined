import { NextResponse } from "next/server";
import { journalViewer, journalFailure } from "@/lib/membership/journal-request";
import { exportJournalTimeline } from "@/lib/membership/journal-repository";
import { JournalError, JOURNAL_HEADERS } from "@/lib/membership/journal-model";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await journalViewer(request);
    const collection = new URL(request.url).searchParams.get("collection");
    if (collection !== null && collection !== "private" && collection !== "public") throw new JournalError(400, "Choose a valid journal collection.");
    const entries = collection === null ? await exportJournalTimeline(user) : await exportJournalTimeline(user, collection);
    return NextResponse.json({ entries }, { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
