import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson } from "@/lib/platform/ops-api";
import { searchMemberSmsOneOffRecipients } from "@/lib/communications/member-sms-one-off";
import { memberSmsOneOffErrorResponse } from "@/lib/communications/member-sms-one-off-api";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const viewer=await getCurrentPlatformViewer();
    if(!viewer)return opsJson({error:"Administrator access is required."},401);
    const params=new URL(request.url).searchParams;
    if([...params.keys()].some(key=>key!=="q")||params.getAll("q").length!==1)return opsJson({error:"Search for one member by name or email."},400);
    return opsJson(await searchMemberSmsOneOffRecipients(viewer.authUserId,params.get("q")));
  }catch(error){return memberSmsOneOffErrorResponse(error);}
}
