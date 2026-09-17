import "server-only";
import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { JournalError, JOURNAL_HEADERS } from "./journal-model";
export async function journalViewer(request:Request,write=false) {
  if(write && !isTrustedPlatformOrigin(request)) throw new JournalError(403,"Request origin is not allowed.");
  if(getPlatformConfiguration().mode!=="connected") throw new JournalError(503,"Your journal is not connected.");
  const viewer=await getCurrentPlatformViewer();
  if(!viewer) throw new JournalError(401,"Sign in to open your journal.");
  return viewer.authUserId;
}
export function journalFailure(error:unknown) {
  if(error instanceof JournalError) return NextResponse.json({error:error.message},{status:error.status,headers:JOURNAL_HEADERS});
  console.error("Member journal request failed",{errorType:error instanceof Error ? error.name : "UnknownError"});
  return NextResponse.json({error:"Your journal is temporarily unavailable. Your draft has not been cleared."},{status:503,headers:JOURNAL_HEADERS});
}
