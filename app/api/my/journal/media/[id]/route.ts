import { journalViewer,journalFailure } from "@/lib/membership/journal-request";
import { journalMediaUrl } from "@/lib/membership/journal-repository";
import { JOURNAL_HEADERS } from "@/lib/membership/journal-model";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const user=await journalViewer(request);const {id}=await params;return new Response(null,{status:307,headers:{...JOURNAL_HEADERS,Location:await journalMediaUrl(user,id),"Referrer-Policy":"no-referrer"}});}catch(error){return journalFailure(error);}}
