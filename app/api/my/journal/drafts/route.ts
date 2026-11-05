import { NextResponse } from "next/server";
import { journalViewer, journalFailure } from "@/lib/membership/journal-request";
import { createJournalDraft, getJournalDrafts } from "@/lib/membership/journal-repository";
import { JOURNAL_HEADERS, readJournalJson, validateJournalDraftInput } from "@/lib/membership/journal-model";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const user = await journalViewer(request);
    return NextResponse.json(await getJournalDrafts(user, new URL(request.url).searchParams.get("before")), { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await journalViewer(request, true), input = validateJournalDraftInput(await readJournalJson(request));
    return NextResponse.json({ entry: await createJournalDraft(user, input) }, { status: 201, headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
