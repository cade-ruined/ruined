import "server-only";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { MemberSmsOneOffError } from "./member-sms-one-off-model";

export async function requireMemberSmsOneOffMutation(request:Request) {
  const access=await requireOpsMutationRequest(request);
  if (access.response) {
    return {response:opsJson({...await access.response.json(),sendStarted:false},access.response.status)};
  }
  return access;
}
export async function readMemberSmsOneOffJson(request:Request):Promise<unknown> {
  if (Number(request.headers.get("content-length"))>4096) throw new MemberSmsOneOffError(413,"That text-message request is too large.");
  const reader=request.body?.getReader();
  if (!reader) throw new MemberSmsOneOffError(400,"Complete the text-message request.");
  const decoder=new TextDecoder();let bytes=0,text="";
  try {
    for (;;) {
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;if(bytes>4096){await reader.cancel();throw new MemberSmsOneOffError(413,"That text-message request is too large.");}
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  } catch(error) {
    if(error instanceof MemberSmsOneOffError)throw error;
    throw new MemberSmsOneOffError(400,"That text-message request is invalid.");
  } finally {reader.releaseLock();}
}
export function memberSmsOneOffErrorResponse(error:unknown) {
  // These errors are deliberately raised only before the durable send claim.
  if(error instanceof MemberSmsOneOffError)return opsJson({error:error.message,sendStarted:false},error.status);
  console.error("One-off text operation unavailable",{errorType:error instanceof Error?error.name:"UnknownError"});
  return opsJson({error:"The text-message request could not be confirmed. Check Activity before trying again."},503);
}
