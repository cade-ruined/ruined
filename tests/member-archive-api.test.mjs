import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const actor='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002';
const endpoint=`https://members.example.test/api/ops/members/${member}/archive`;
const payload={action:'archive',expectedVersion:0,reason:'Inactive registration'};
const result={archivedAt:null,version:0,memberName:'Member',allowed:true,restoreAllowed:false,blockers:[],reason:null};
const context={params:Promise.resolve({memberId:member})};
async function load(path,dependencies,globals={}) {
 const source=await readFile(new URL(`../${path}`,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const cjsModule={exports:{}};
 new Function('require','module','exports',...Object.keys(globals),compiled)(name=>{assert.ok(name in dependencies,`Unexpected dependency ${name}`);return dependencies[name];},cjsModule,cjsModule.exports,...Object.values(globals));
 return cjsModule.exports;
}
async function fixture() {
 const state={viewer:{authUserId:actor},queries:[],error:null,logs:[]};
 const session={getCurrentPlatformViewer:async()=>state.viewer};
 const requestPolicy=await load('src/lib/auth/request.ts',{}, {process:{env:{NODE_ENV:'production'}}});
 const api=await load('src/lib/platform/ops-api.ts',{'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/auth/request':requestPolicy,'@/lib/auth/session':session,'@/lib/platform/ops-operating-repository':{OpsOperatingRepositoryError:class extends Error {}}});
 const sql=async(strings,...values)=>{state.queries.push({query:strings.join('?'),values});if(state.error)throw state.error;return [{archive:result}];};
 const repository=await load('src/lib/platform/member-archive-repository.ts',{'server-only':{},'@/lib/database/server':{getApplicationDatabase:()=>sql}});
 const route=await load('app/api/ops/members/[memberId]/archive/route.ts',{'@/lib/auth/session':session,'@/lib/platform/ops-api':api,'@/lib/platform/member-archive-repository':repository},{console:{error:(...args)=>state.logs.push(args)}});
 return {state,route};
}
function request(body=payload,headers={}) {return new Request(endpoint,{method:'POST',headers:{origin:new URL(endpoint).origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});}

test('archive API enforces authentication, trusted origin and payload boundaries before SQL',async()=>{
 const {state,route}=await fixture();
 state.viewer=null;assert.equal((await route.GET(new Request(endpoint),context)).status,401);
 assert.equal((await route.POST(request(),context)).status,401);
 state.viewer={authUserId:actor};
 assert.equal((await route.POST(request(payload,{origin:'https://attacker.example'}),context)).status,403);
 assert.equal((await route.POST(request(payload,{'content-type':'text/plain'}),context)).status,415);
 for(const body of [null,[],{},'archive',{...payload,actorId:actor},{...payload,memberId:member},{...payload,action:'delete'},
   {...payload,reason:'x'},{...payload,reason:'x'.repeat(1001)},...[null,-1,0.5,'0',2147483647].map(expectedVersion=>({...payload,expectedVersion}))]) {
   assert.equal((await route.POST(request(body),context)).status,400);
 }
 assert.equal(state.queries.length,0);
});
test('archive API delegates actor and version to locked database authorization and exposes no provider calls',async()=>{
 const {state,route}=await fixture();
 const read=await route.GET(new Request(endpoint),context);
 assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.deepEqual(await read.json(),{archive:result});
 for(const action of ['archive','restore']) {
   assert.equal((await route.POST(request({...payload,action}),context)).status,200);
   assert.deepEqual(state.queries.at(-1).values,[actor,member,action,0,payload.reason]);
 }
 for(const [code,status] of [['PT403',403],['PT404',404],['PT409',409]]) {
   state.error=Object.assign(new Error('Record unavailable'),{code});
   assert.equal((await route.POST(request(),context)).status,status);
 }
 state.error=new Error('SECRET_DATABASE_DETAIL');
 const failure=await route.POST(request(),context);assert.equal(failure.status,503);
 assert.doesNotMatch(JSON.stringify(await failure.json()),/SECRET/);assert.doesNotMatch(JSON.stringify(state.logs),/SECRET/);
});
