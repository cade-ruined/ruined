import { NextResponse } from "next/server";
import { journalViewer, journalFailure } from "@/lib/membership/journal-request";
import { deleteJournalEntry, editJournalEntry, getJournalEntry, saveJournalEntry } from "@/lib/membership/journal-repository";
import { JournalError, JOURNAL_HEADERS, readJournalJson, validateJournalEdit, validateJournalVersion } from "@/lib/membership/journal-model";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await journalViewer(request), { id } = await params;
    return NextResponse.json({ entry: await getJournalEntry(user, id) }, { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await journalViewer(request, true), value = await readJournalJson(request), { id } = await params;
    if (value && typeof value === "object" && "action" in value && value.action === "edit") {
      return NextResponse.json({ entry: await editJournalEntry(user, id, validateJournalEdit(value, id)) }, { headers: JOURNAL_HEADERS });
    }
    if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("saved" in value) || typeof value.saved !== "boolean") throw new JournalError(400, "Choose whether to save this entry.");
    return NextResponse.json({ entry: await saveJournalEntry(user, id, value.saved) }, { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await journalViewer(request, true), value = await readJournalJson(request), { id } = await params;
    if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("expectedVersion" in value)) throw new JournalError(400, "An entry version is required.");
    await deleteJournalEntry(user, id, validateJournalVersion(value.expectedVersion));
    return NextResponse.json({ deleted: true }, { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
