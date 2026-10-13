import { AdminEmailError } from "@/lib/communications/admin-email-model";
import { emailGroupPurposeLabel, escapeEmailGroupHtml } from "@/lib/communications/email-group-campaign-model";
import { inspectEmailGroupUnsubscribe, unsubscribeEmailGroupCampaign } from "@/lib/communications/email-group-campaign-service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
const page=(text:string,status=200,form="")=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ruined email preferences</title><body><main><h1>Ruined email preferences</h1><p>${escapeEmailGroupHtml(text)}</p>${form}</main></body></html>`,{status,headers});
function failure(error:unknown) {return page(error instanceof AdminEmailError ? error.message : "Email preferences are temporarily unavailable. Please try again.",error instanceof AdminEmailError ? error.status : 503);}
export async function GET(request:Request) {
  try {
    const token=new URL(request.url).searchParams.get("token"),result=await inspectEmailGroupUnsubscribe(token);
    return page(`Unsubscribe from Ruined ${emailGroupPurposeLabel(result.purpose)}? Other email preferences will remain unchanged.`,200,
      `<form method="post"><button type="submit">Unsubscribe</button></form>`);
  } catch(error) {return failure(error);}
}
export async function POST(request:Request) {
  try {
    if(Number(request.headers.get("content-length"))>2048) throw new AdminEmailError(413,"The request is too large.");
    const reader=request.body?.getReader(),decoder=new TextDecoder();let bytes=0,body="";
    if(reader) {try {for(;;) {const item=await reader.read();if(item.done) break;bytes+=item.value.byteLength;body+=decoder.decode(item.value,{stream:true});if(bytes>2048) {await reader.cancel();throw new AdminEmailError(413,"The request is too large.");}}} finally {reader.releaseLock();}}
    const result=await unsubscribeEmailGroupCampaign(new URL(request.url).searchParams.get("token"));
    body+=decoder.decode();
    if(new URLSearchParams(body).get("List-Unsubscribe")==="One-Click") return new Response(null,{status:202,headers});
    return page(`You are unsubscribed from Ruined ${emailGroupPurposeLabel(result.purpose)}. Other email preferences have not been changed.`);
  } catch(error) {return failure(error);}
}
