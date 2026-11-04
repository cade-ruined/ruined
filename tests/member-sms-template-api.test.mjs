import assert from "node:assert/strict";
import test from "node:test";
import { loader, id } from "./helpers/member-sms-fixture.mjs";
const origin="https://members.theruinedproject.com";
function fixture(){
  const state={viewer:{authUserId:id(1)},failure:null},calls=[];
  const dependencies={"@/lib/auth/session":{getCurrentPlatformViewer:async()=>state.viewer},
    "@/lib/platform/ops-operating-repository":{OpsOperatingRepositoryError:class extends Error{}}};
  const load=loader({NODE_ENV:"production",NEXT_PUBLIC_SITE_URL:origin},dependencies);
  const {MemberSmsTemplateError}=load("src/lib/communications/member-sms-template-model.ts");
  dependencies["@/lib/communications/member-sms-template-service"]={
    getMemberSmsTemplates:async actor=>{calls.push({actor,action:"get"});if(state.failure)throw state.failure;return{templates:[]};},
    previewMemberSmsTemplate:async(actor,value)=>{calls.push({actor,value,action:"preview"});if(state.failure)throw state.failure;return{template:value,preview:"Ruined fixture",reviewDigest:"a".repeat(64)};},
    saveMemberSmsTemplate:async(actor,value)=>{calls.push({actor,value,action:"save"});if(state.failure)throw state.failure;return{template:value,preview:"Ruined fixture"};},
  };
  return{state,calls,MemberSmsTemplateError,route:load("app/api/ops/messages/texts/templates/route.ts")};
}
const request=(body,headers={})=>new Request(`${origin}/api/ops/messages/texts/templates`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json",...headers},body:typeof body==="string"?body:JSON.stringify(body)});
async function check(response,status){assert.equal(response.status,status);assert.match(response.headers.get("cache-control"),/no-store/);return response.json();}
const edit={id:"call_reminder",body:"Ruined: {{call_title}} {{call_link}}",enabled:true,noticeMinutes:60,revision:0};
test("template API requires sign-in, same-origin JSON and bounded valid objects before reaching service",async()=>{
  const f=fixture();f.state.viewer=null;await check(await f.route.GET(),401);await check(await f.route.POST(request({action:"preview",...edit})),401);
  f.state.viewer={authUserId:id(1)};
  await check(await f.route.POST(request({action:"preview",...edit},{Origin:"https://outside.test"})),403);
  await check(await f.route.POST(request({action:"preview",...edit},{"Content-Type":"text/plain"})),415);
  const noOrigin=request({action:"preview",...edit});noOrigin.headers.delete("origin");await check(await f.route.POST(noOrigin),403);
  for(const payload of ["{broken","null","[]","123",JSON.stringify({action:"send",...edit})])await check(await f.route.POST(request(payload)),400);
  await check(await f.route.POST(request("x",{"Content-Length":"9000"})),413);
  await check(await f.route.POST(request(JSON.stringify({body:"é".repeat(5000)}))),413);
  assert.equal(f.calls.length,0);
});
test("template API passes exact preview/save payloads and preserves conflict and administrator denials",async()=>{
  const f=fixture();await check(await f.route.GET(),200);
  const preview=await check(await f.route.POST(request({action:"preview",...edit})),200);assert.equal(preview.reviewDigest,"a".repeat(64));
  const save={...edit,reviewDigest:preview.reviewDigest};await check(await f.route.POST(request({action:"save",...save})),200);
  assert.deepEqual(f.calls,[{actor:id(1),action:"get"},{actor:id(1),action:"preview",value:edit},{actor:id(1),action:"save",value:save}]);
  for(const status of [400,403,409]){f.state.failure=new f.MemberSmsTemplateError(status,"Safe template error");const result=await check(await f.route.POST(request({action:"save",...save})),status);assert.equal(result.error,"Safe template error");}
});
