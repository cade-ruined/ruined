import { opsJson } from "@/lib/platform/ops-api";
import { reviewMemberSmsOneOff } from "@/lib/communications/member-sms-one-off";
import { memberSmsOneOffErrorResponse, readMemberSmsOneOffJson, requireMemberSmsOneOffMutation } from "@/lib/communications/member-sms-one-off-api";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  try {
    const access=await requireMemberSmsOneOffMutation(request);if("response"in access)return access.response;
    return opsJson(await reviewMemberSmsOneOff(access.viewer.authUserId,await readMemberSmsOneOffJson(request)));
  }catch(error){return memberSmsOneOffErrorResponse(error);}
}
