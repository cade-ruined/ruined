import { NextResponse } from "next/server";
import { journalViewer, journalFailure } from "@/lib/membership/journal-request";
import { exportJournalTimeline } from "@/lib/membership/journal-repository";
import { JOURNAL_HEADERS } from "@/lib/membership/journal-model";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await journalViewer(request);
    return NextResponse.json({ entries: await exportJournalTimeline(user) }, { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
