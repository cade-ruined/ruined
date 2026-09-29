import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
async function load(path,deps){const mod={exports:{}};const out=ts.transpileModule(await read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function("require","module","exports",out)(name=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return deps[name];},mod,mod.exports);return mod.exports;}
const model=await load("src/lib/stripe/payment-method-model.ts",{});
async function fixture(){
 let authenticated=true,trusted=true,failure=null;const calls=[];
 const state={enabled:true,eligible:true,canRemove:false,removalPending:false,state:"not_saved",reason:null,paymentMethod:null};
 const method=name=>async(...args)=>{calls.push({name,args});if(failure)throw failure;return name==="start"?{url:"https://checkout.stripe.com/c/pay/test"}:state;};
 const api=await load("app/api/stripe/payment-method/route.ts",{
  "next/server":{NextResponse:{json:(body,options={})=>new Response(JSON.stringify(body),{...options,headers:{"Content-Type":"application/json",...options.headers}})}},
  "@/lib/auth/session":{getCurrentPlatformViewer:async()=>authenticated?{authUserId:"actor",email:"member@example.test"}:null},
  "@/lib/stripe/server":{getApplicationOrigin:()=>"https://members.example.test",isTrustedCheckoutOrigin:()=>trusted},
  "@/lib/stripe/payment-method-model":model,
  "@/lib/stripe/payment-method-service":{getMemberPaymentMethodStatus:method("status"),startMemberPaymentMethodSetup:method("start"),withdrawMemberPaymentMethod:method("withdraw")},
 });
 return{api,calls,state,setAuthenticated:value=>authenticated=value,setTrusted:value=>trusted=value,setFailure:value=>failure=value};
}
const request=(method,body)=>new Request("https://members.example.test/api/stripe/payment-method",{method,body:typeof body==="string"?body:JSON.stringify(body),headers:{"Content-Type":"application/json"}});
test("payment method API requires authentication and never caches status",async()=>{
 const f=await fixture();f.setAuthenticated(false);
 for(const operation of [()=>f.api.GET(),()=>f.api.POST(request("POST",{})),()=>f.api.DELETE(request("DELETE",{confirmation:true}))]){
  const response=await operation();assert.equal(response.status,401);assert.equal(response.headers.get("cache-control"),"no-store");
 }assert.equal(f.calls.length,0);
 f.setAuthenticated(true);const response=await f.api.GET();assert.deepEqual(await response.json(),f.state);
});
test("cross-origin mutation rejected before touching identity or Stripe",async()=>{
 const f=await fixture();f.setTrusted(false);
 assert.equal((await f.api.POST(request("POST",{}))).status,403);assert.equal((await f.api.DELETE(request("DELETE",{confirmation:true}))).status,403);assert.equal(f.calls.length,0);
});
test("setup API uses server origin and forwards explicit storage-only consent",async()=>{
 const f=await fixture();const body={attemptId:"attempt",consentAccepted:true,consentVersion:model.PAYMENT_SETUP_CONSENT_VERSION,applicationOrigin:"https://attacker.example"};
 const response=await f.api.POST(request("POST",body));assert.equal(response.status,200);
 assert.deepEqual(f.calls[0],{name:"start",args:[{authUserId:"actor",attemptId:"attempt",consentAccepted:true,consentVersion:model.PAYMENT_SETUP_CONSENT_VERSION,applicationOrigin:"https://members.example.test"}]});
 assert.equal((await f.api.POST(request("POST","{"))).status,400);assert.equal((await f.api.POST(request("POST",[]))).status,400);
});
test("DELETE requires affirmative confirmation and returns authoritative fresh state",async()=>{
 const f=await fixture();assert.equal((await f.api.DELETE(request("DELETE",{confirmation:"true"}))).status,400);assert.equal(f.calls.length,0);
 const response=await f.api.DELETE(request("DELETE",{confirmation:true}));assert.deepEqual(await response.json(),f.state);assert.equal(f.calls[0].name,"withdraw");
});
test("provider errors do not leak secrets while safe eligibility conflicts remain readable",async()=>{
 const f=await fixture();f.setFailure(new Error("sk_test_secret internal provider details"));let response=await f.api.GET();assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/sk_test|internal/);
 f.setFailure(new model.PaymentMethodSetupError("Your checkout is already in progress.",409));response=await f.api.POST(request("POST",{}));assert.equal(response.status,409);assert.match(await response.text(),/already in progress/);
});
