import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
async function load(path,deps={}) {
 const source=await readFile(new URL(`../${path}`,import.meta.url),"utf8");
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};new Function("require","module","exports",output)(name=>{assert.ok(name in deps,`Unexpected ${name}`);return deps[name];},mod,mod.exports);return mod.exports;
}
const model=await load("src/lib/membership/journal-model.ts");
const id=randomUUID();
const input={kind:"text",title:"A moment",body:"The whole story",mediaIds:[],eventYear:2024,eventMonth:2,eventDay:29,includeOnTimeline:true};
async function fixture(path) {
 const calls=[]; let failure=null;
 const methods=["getJournal","getJournalEntry","createJournalEntry","editJournalEntry","saveJournalEntry","deleteJournalEntry","exportJournalTimeline"];
 const repository=Object.fromEntries(methods.map(name=>[name,async(...args)=>{calls.push({name,args});if(failure)throw failure;return name==="exportJournalTimeline"?[]:{id,version:"3"};}]));
 const route=await load(path,{"next/server":{NextResponse:Response},"@/lib/membership/journal-model":model,"@/lib/membership/journal-repository":repository,"@/lib/membership/journal-request":{
 journalViewer:async(request,write)=>{calls.push({name:"viewer",write});return "verified-owner";},journalFailure:error=>Response.json({error:error.message},{status:error.status??503,headers:model.JOURNAL_HEADERS})}});
 return{...route,calls,fail(error){failure=error;}};
}
const req=(method,body,path="/api/my/journal")=>new Request(`https://members.example.test${path}`,{method,headers:{"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
const context={params:Promise.resolve({id})};
test("Journal GET forwards complete filters and validates dates/view before querying entries",async()=>{
 const f=await fixture("app/api/my/journal/route.ts");
 const response=await f.GET(req("GET",undefined,"/api/my/journal?view=timeline&order=oldest&year=2020&search=hello&saved=true"));
 assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(response.headers.get("vary"),"Cookie");
 assert.deepEqual(f.calls.find(call=>call.name==="getJournal").args,["verified-owner",null,true,{view:"timeline",order:"oldest",search:"hello",year:2020}]);
 for(const query of ["year=bad","view=everyone","order=random"]){const response=await f.GET(req("GET",undefined,`/api/my/journal?${query}`));assert.equal(response.status,400);}
 assert.equal(f.calls.filter(call=>call.name==="getJournal").length,1);
});
test("Journal creation accepts title-only milestones and preserves full day/body payload",async()=>{
 const f=await fixture("app/api/my/journal/route.ts");
 const response=await f.POST(req("POST",{...input,id,body:""}));assert.equal(response.status,201);
 assert.deepEqual(f.calls.find(call=>call.name==="createJournalEntry").args,["verified-owner",{...input,id,body:""}]);
 const bad=await f.POST(req("POST",{...input,id,eventYear:null}));assert.equal(bad.status,400);
 assert.equal(f.calls.filter(call=>call.name==="createJournalEntry").length,1);
});
test("Journal edit requires explicit version/full fields and preserves bookmark PATCH compatibility",async()=>{
 const f=await fixture("app/api/my/journal/[id]/route.ts");
 let response=await f.PATCH(req("PATCH",{action:"edit",expectedVersion:"2",...input}),context);assert.equal(response.status,200);
 assert.deepEqual(f.calls.find(call=>call.name==="editJournalEntry").args,["verified-owner",id,{...input,expectedVersion:"2"}]);
 response=await f.PATCH(req("PATCH",{action:"edit",...input}),context);assert.equal(response.status,409);
 response=await f.PATCH(req("PATCH",{action:"edit",expectedVersion:"2",...input,ownerId:randomUUID()}),context);assert.equal(response.status,400);
 response=await f.PATCH(req("PATCH",{saved:true}),context);assert.equal(response.status,200);
 assert.deepEqual(f.calls.find(call=>call.name==="saveJournalEntry").args,["verified-owner",id,true]);
 assert.equal(f.calls.filter(call=>call.name==="editJournalEntry").length,1);
});
test("Journal stale reload/deletion and complete export are private owner-scoped APIs",async()=>{
 const f=await fixture("app/api/my/journal/[id]/route.ts");
 assert.equal((await f.GET(req("GET"),context)).status,200);
 assert.deepEqual(f.calls.find(call=>call.name==="getJournalEntry").args,["verified-owner",id]);
 assert.equal((await f.DELETE(req("DELETE",{expectedVersion:"3"}),context)).status,200);
 assert.deepEqual(f.calls.find(call=>call.name==="deleteJournalEntry").args,["verified-owner",id,"3"]);
 assert.equal((await f.DELETE(req("DELETE",{}),context)).status,400);
 f.fail(new model.JournalError(409,"Changed elsewhere"));
 const stale=await f.PATCH(req("PATCH",{action:"edit",expectedVersion:"2",...input}),context);assert.equal(stale.status,409);assert.equal(stale.headers.get("cache-control"),"private, no-store");
 const exporter=await fixture("app/api/my/journal/export/route.ts");const exported=await exporter.GET(req("GET"));assert.deepEqual(await exported.json(),{entries:[]});assert.equal(exported.headers.get("vary"),"Cookie");
 assert.deepEqual(exporter.calls.find(call=>call.name==="exportJournalTimeline").args,["verified-owner"]);
});
