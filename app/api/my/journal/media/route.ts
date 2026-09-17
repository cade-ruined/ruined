import { NextResponse } from "next/server";
import { journalViewer,journalFailure } from "@/lib/membership/journal-request";
import { prepareJournalUpload } from "@/lib/membership/journal-repository";
import { JOURNAL_HEADERS,readJournalJson } from "@/lib/membership/journal-model";
export const runtime="nodejs";
export async function POST(request:Request){try{const user=await journalViewer(request,true);return NextResponse.json(await prepareJournalUpload(user,await readJournalJson(request)),{headers:JOURNAL_HEADERS});}catch(error){return journalFailure(error);}}
