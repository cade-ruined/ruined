import { NextResponse } from "next/server";
import { journalViewer,journalFailure } from "@/lib/membership/journal-request";
import { createJournalEntry,getJournal } from "@/lib/membership/journal-repository";
import { JOURNAL_HEADERS,readJournalJson,validateJournalInput } from "@/lib/membership/journal-model";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request){try{const user=await journalViewer(request);const url=new URL(request.url);return NextResponse.json(await getJournal(user,url.searchParams.get("before"),url.searchParams.get("saved")==="true"),{headers:JOURNAL_HEADERS});}catch(error){return journalFailure(error);}}
export async function POST(request:Request){try{const user=await journalViewer(request,true);const input=validateJournalInput(await readJournalJson(request));return NextResponse.json({entry:await createJournalEntry(user,input)},{status:201,headers:JOURNAL_HEADERS});}catch(error){return journalFailure(error);}}
