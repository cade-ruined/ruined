import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const owner = '11111111-1111-4111-8111-111111111111';
const another = '22222222-2222-4222-8222-222222222222';
const source = await readFile(new URL('../app/api/my/badges/collection/route.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class BadgeNotificationError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fixture({ mode='connected', auth='authenticated', trusted=true }={}) {
  const calls=[]; let failure;
  const run = async (name,...args) => { calls.push([name,...args]); if(failure) throw failure; };
  const dependencies={
    'next/server': { NextResponse: { json:(body,options)=>Response.json(body,options) } },
    '@/lib/auth/request': { isTrustedPlatformOrigin:()=>trusted },
    '@/lib/auth/session': { resolvePlatformSession: async (_client, options)=>{ calls.push(['session',options]); return {status:auth,viewer:{authUserId:owner}}; } },
    '@/lib/supabase/server': { createSupabaseServerClient:async()=>({}) },
    '@/lib/platform/config': { getPlatformConfiguration:()=>({mode}) },
    '@/lib/membership/badge-repository': { BadgeNotificationError },
    '@/lib/membership/badge-collection-repository': {
      getMemberBadgeCollection:async id=>{await run('get',id);return {ownerId:id,seenAt:null,badges:[]};},
      markMemberBadgeCollectionSeen:(...args)=>run('seen',...args),
      setMemberBadgeVisibility:(...args)=>run('visibility',...args),
    },
  };
  const loaded={exports:{}};
  new Function('require','module','exports',code)(name=>{ assert.ok(Object.hasOwn(dependencies,name),name); return dependencies[name]; },loaded,loaded.exports);
  return {api:loaded.exports,calls,fail:error=>{failure=error;}};
}
const request=(method,body,headers={})=>new Request('https://members.example.test/api/my/badges/collection',{
  method,headers:{'content-type':'application/json',origin:'https://members.example.test',...headers},
  ...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),
});
const valid={action:'visibility',ownerId:owner,badgeKey:'first-words',visible:true};

test('collection API is owner-bound, private and validates the live identity',async()=>{
  const f=fixture();const response=await f.api.GET(request('GET'));
  assert.deepEqual(await response.json(),{ownerId:owner,seenAt:null,badges:[]});
  assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(response.headers.get('vary'),'Cookie');
  assert.deepEqual(f.calls,[['session',{verifyCurrentUser:true}],['get',owner]]);
  f.calls.length=0;
  assert.equal((await f.api.GET(request('GET',undefined,{'x-ruined-session-owner':another}))).status,409);
  assert.equal(f.calls.some(call=>call[0]==='get'),false);
});

test('visibility and introduction persist only their exact action for the signed-in owner',async()=>{
  const f=fixture();
  assert.deepEqual(await (await f.api.PATCH(request('PATCH',valid))).json(),{ok:true,ownerId:owner});
  assert.deepEqual(f.calls.at(-1),['visibility',owner,'first-words',true]);
  await f.api.PATCH(request('PATCH',{...valid,visible:false}));assert.deepEqual(f.calls.at(-1),['visibility',owner,'first-words',false]);
  await f.api.POST(request('POST',{action:'seen',ownerId:owner}));assert.deepEqual(f.calls.at(-1),['seen',owner]);
  f.calls.length=0;
  for(const method of ['POST','PATCH']){
    const body=method==='POST'?{action:'seen',ownerId:another}:{...valid,ownerId:another};
    const response=await f.api[method](request(method,body));assert.equal(response.status,409);assert.equal((await response.json()).code,'account_changed');
  }
  assert.equal(f.calls.some(call=>call[0]!=='session'),false);
});

test('collection writes reject CSRF, preview, missing identity, extra fields and unbounded bodies',async()=>{
  for(const [options,status] of [[{trusted:false},403],[{mode:'preview'},503],[{auth:'signed_out'},401],[{auth:'unavailable'},503]]){
    const f=fixture(options);assert.equal((await f.api.PATCH(request('PATCH',valid))).status,status);
    assert.equal(f.calls.some(call=>call[0]!=='session'),false);
  }
  const f=fixture();
  for(const body of [null,[],{},'bad json',{...valid,visible:'true'},{...valid,memberId:another},{...valid,ownerId:'invalid'},{...valid,action:'seen'},{...valid,badgeKey:'../private'}]){
    assert.equal((await f.api.PATCH(request('PATCH',body))).status,400);
  }
  assert.equal((await f.api.POST(request('POST',valid))).status,400);
  assert.equal((await f.api.PATCH(request('PATCH',valid,{'content-type':'text/plain'}))).status,415);
  assert.equal((await f.api.PATCH(request('PATCH',valid,{'content-length':'513'}))).status,413);
  assert.equal((await f.api.PATCH(request('PATCH',' '.repeat(513)))).status,413);
  assert.equal(f.calls.some(call=>call[0]!=='session'),false);
  f.fail(new BadgeNotificationError(404,'That earned badge is unavailable.'));
  assert.equal((await f.api.PATCH(request('PATCH',valid))).status,404);
});
