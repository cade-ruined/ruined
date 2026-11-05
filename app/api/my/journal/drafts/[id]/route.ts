import { NextResponse } from "next/server";
import { journalViewer, journalFailure } from "@/lib/membership/journal-request";
import { completeJournalDraft, deleteJournalDraft, editJournalDraft, getJournalDraft } from "@/lib/membership/journal-repository";
import { JournalError, JOURNAL_HEADERS, readJournalJson, validateJournalDraftEdit, validateJournalEdit, validateJournalVersion } from "@/lib/membership/journal-model";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await journalViewer(request), { id } = await params;
    return NextResponse.json({ entry: await getJournalDraft(user, id) }, { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await journalViewer(request, true), value = await readJournalJson(request), { id } = await params;
    if (value && typeof value === "object" && "action" in value && value.action === "complete") {
      return NextResponse.json({ entry: await completeJournalDraft(user, id, validateJournalEdit({ ...value, action: "edit" }, id)) }, { headers: JOURNAL_HEADERS });
    }
    return NextResponse.json({ entry: await editJournalDraft(user, id, validateJournalDraftEdit(value, id)) }, { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await journalViewer(request, true), value = await readJournalJson(request), { id } = await params;
    if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("expectedVersion" in value)) throw new JournalError(400, "A draft version is required.");
    await deleteJournalDraft(user, id, validateJournalVersion(value.expectedVersion));
    return NextResponse.json({ deleted: true }, { headers: JOURNAL_HEADERS });
  } catch (error) { return journalFailure(error); }
}
