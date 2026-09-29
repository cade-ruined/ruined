import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const memberId="11111111-1111-4111-8111-111111111111", connectionId="22222222-2222-4222-8222-222222222222", strangerId="33333333-3333-4333-8333-333333333333";
function load(path,dependencies){ const compiled=ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText; const loaded={exports:{}}; new Function("require","module","exports",compiled)(name=>{assert.ok(Object.hasOwn(dependencies,name),`Unexpected dependency ${name}`);return dependencies[name];},loaded,loaded.exports);return loaded.exports; }
const model=load("src/lib/platform/circle-placement-model.ts",{});
class OpsRepositoryError extends Error {constructor(code,message){super(message);this.code=code;}}
function fixture({authorized=true}={}){
 const writes=[],reads=[];
 const tx=async(parts,...values)=>{const query=parts.join("?").replace(/\s+/g," ").trim();
  if(query.startsWith("insert")){writes.push({query,values});return [];}
  reads.push({query,values});
  if(query.includes("from platform_users viewer")){assert.match(query,/viewer.auth_user_id = \?::uuid.*viewer.status = 'active'.*lifecycle.account_state = 'active'/);assert.match(query,/role_slug = 'member'.*revoked_at is null/);return authorized?[{id:memberId,timezone:"America/Denver"}]:[];}
  if(query.includes("from member_referrals referral")){assert.match(query,/referral.referred_member_id is not null/);assert.match(query,/referral.referred_member_id = \?::uuid or referral.inviter_member_id = \?::uuid/);assert.ok(values.every(value=>value===memberId));return [{memberId:connectionId,name:"Known connection"}];}
  if(query.includes("from member_circle_preferences"))return [];
  throw new Error(`Unexpected SQL ${query}`);
 };
 const repo=load("src/lib/platform/circle-placement-repository.ts",{"server-only":{},"@/lib/stripe/database":{getBillingDatabase:()=>({begin:callback=>callback(tx)})},"@/lib/platform/ops-repository":{OpsRepositoryError},"@/lib/platform/leadership-repository":{},"@/lib/platform/circle-placement-model":model});
 return {repo,writes,reads};
}
test("member preferences are owned by verified identity and never accept a client-supplied target member",async()=>{
 const f=fixture(); const result=await f.repo.saveCirclePreferences("verified-actor",{timezone:"America/Denver",availability:["1:evening"],preferredConnectionId:connectionId,memberId:strangerId});
 assert.equal(result.preferences.preferredConnectionId,connectionId);assert.equal(f.writes.length,1);assert.equal(f.writes[0].values[0],memberId);assert.ok(!f.writes[0].values.includes(strangerId));assert.equal(f.reads[0].values[0],"verified-actor");
});
test("missing or revoked member authority cannot read connections or save preferences",async()=>{
 const f=fixture({authorized:false});await assert.rejects(f.repo.getCirclePreferences("unauthorized"),error=>error.code==="forbidden");await assert.rejects(f.repo.saveCirclePreferences("unauthorized",{timezone:"UTC",availability:[],preferredConnectionId:null}),error=>error.code==="forbidden");assert.equal(f.writes.length,0);assert.equal(f.reads.every(read=>read.query.includes("from platform_users viewer")),true);
});
test("a guessed connection UUID is rejected before any write and GET returns only verified invitation connections",async()=>{
 const f=fixture();await assert.rejects(f.repo.saveCirclePreferences("verified-actor",{timezone:"UTC",availability:[],preferredConnectionId:strangerId}),error=>error.code==="invalid_request");assert.equal(f.writes.length,0);
 const view=await f.repo.getCirclePreferences("verified-actor");assert.deepEqual(view.connections,[{memberId:connectionId,name:"Known connection"}]);assert.ok(f.reads.every(read=>!read.query.includes("person_private_profiles")));
});
test("preferences API denies cross-origin saves and signed-out reads before touching records",async()=>{
 let viewer={authUserId:"actor"},trusted=false,calls=0;
 const route=load("app/api/my/circle-preferences/route.ts",{"next/server":{NextResponse:{json:(body,init)=>Response.json(body,init)}},"@/lib/auth/request":{isTrustedPlatformOrigin:()=>trusted},"@/lib/auth/session":{getCurrentPlatformViewer:async()=>viewer},"@/lib/platform/circle-placement-repository":{getCirclePreferences:async()=>{calls++;return {};},saveCirclePreferences:async()=>{calls++;return {}; }},"@/lib/platform/ops-repository":{OpsRepositoryError}});
 const put=()=>new Request("https://members.example/my/circle-preferences",{method:"PUT",headers:{"Content-Type":"application/json"},body:"{}"});
 assert.equal((await route.PUT(put())).status,403);viewer=null;assert.equal((await route.GET(new Request("https://members.example/my/circle-preferences"))).status,401);assert.equal(calls,0);
 trusted=true;viewer={authUserId:"actor"};const response=await route.GET(new Request("https://members.example/my/circle-preferences"));assert.equal(response.headers.get("Cache-Control"),"no-store");assert.equal(calls,1);
});
