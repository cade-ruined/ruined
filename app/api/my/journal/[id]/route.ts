import { NextResponse } from "next/server";
import { journalViewer,journalFailure } from "@/lib/membership/journal-request";
import { saveJournalEntry } from "@/lib/membership/journal-repository";
import { JournalError,JOURNAL_HEADERS,readJournalJson } from "@/lib/membership/journal-model";
export const runtime="nodejs";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{const user=await journalViewer(request,true);const value=await readJournalJson(request);if(!value||typeof value!=="object"||Object.keys(value).length!==1||!("saved" in value)||typeof value.saved!=="boolean")throw new JournalError(400,"Choose whether to save this entry.");const {id}=await params;return NextResponse.json({entry:await saveJournalEntry(user,id,value.saved)},{headers:JOURNAL_HEADERS});}catch(error){return journalFailure(error);}}
