import { NextResponse } from "next/server";
import { journalViewer, journalFailure } from "@/lib/membership/journal-request";
import { createJournalEntry, getJournal } from "@/lib/membership/journal-repository";
import { JournalError, JOURNAL_HEADERS, readJournalJson, validateJournalInput } from "@/lib/membership/journal-model";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const user = await journalViewer(request), url = new URL(request.url);
    const view = url.searchParams.get("view"), order = url.searchParams.get("order"), year = url.searchParams.get("year");
    if ((view !== null && !["journal", "timeline"].includes(view)) || (order !== null && !["oldest", "newest"].includes(order))
      || (year !== null && !/^\d{4}$/.test(year))) throw new JournalError(400, "Choose a valid journal view.");
    return NextResponse.json(await getJournal(user, url.searchParams.get("before"), url.searchParams.get("saved") === "true", {
      view: view === "timeline" ? "timeline" : "journal", order: order === "oldest" ? "oldest" : "newest",
      search: url.searchParams.get("search") ?? "", year: year === null ? null : Number(year),
    }), { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await journalViewer(request, true), input = validateJournalInput(await readJournalJson(request));
    return NextResponse.json({ entry: await createJournalEntry(user, input) }, { status: 201, headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
