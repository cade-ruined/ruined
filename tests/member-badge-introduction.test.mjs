import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../app/my/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function fixture({state='authenticated',dismissed=false,fail=false,viewer=true}={}){
 const calls=[], member={identity:{authUserId:'owner'},artifact:null,artifacts:[]};
 const welcome={ownerId:'owner',dismissedAt:dismissed?'2026-10-26T12:00:00Z':null,calendarViewedAt:null,hasJournalEntry:true};
 const deps={
  'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  'next/navigation':{redirect:path=>{throw {redirect:path};}},
  '@/components/platform/MemberHome':{default:'MemberHome'},
  '@/components/platform/PlatformUnavailable':{default:'PlatformUnavailable'},
  '@/lib/database/server':{withFreshApplicationDatabaseRead:async(name,read)=>{calls.push(name);return read();}},
  '@/lib/membership/artifact-products':{resolveMemberHomeArtifactProducts:member=>member},
  '@/lib/membership/welcome-repository':{getMemberWelcome:async id=>{calls.push(id);if(fail)throw Error('temporary failure');return welcome;}},
  '@/lib/membership/page-context':{getMembershipPageContext:async()=>({state,viewer:state==='preview'||!viewer?null:{authUserId:'owner'},data:['authenticated','preview'].includes(state)?member:null})},
  '@/lib/membership/preview':{PREVIEW_MEMBER_HOME:member},
  '@/lib/membership/repository':{getMemberHome:async()=>member},
  '@/lib/shopify':{getProducts:async()=>[]},
 };
 const loaded={exports:{}};
 new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},loaded,loaded.exports);
 return {page:loaded.exports.default,calls,welcome,member};
}
test('first member visit opens the actual profile with resumable welcome progress instead of a badge detour',async()=>{
 const f=fixture();const tree=await f.page();assert.equal(tree.type,'MemberHome');
 assert.deepEqual(tree.props,{member:f.member,preview:false,welcome:f.welcome});
 assert.deepEqual(f.calls,['member-welcome','owner']);
 const dismissed=fixture({dismissed:true});const returning=await dismissed.page();
 assert.equal(returning.type,'MemberHome');assert.deepEqual(returning.props.welcome,dismissed.welcome);
});
test('profile preview uses local welcome progress and never reads or writes the real member state',async()=>{
 const preview=fixture({state:'preview'});const tree=await preview.page();assert.equal(tree.type,'MemberHome');
 assert.deepEqual(tree.props.welcome,{ownerId:'owner',dismissedAt:null,calendarViewedAt:null,hasJournalEntry:false});
 assert.equal(tree.props.preview,true);assert.deepEqual(preview.calls,[]);
});
test('profile auth and access gates run before optional welcome reads',async()=>{
 const denied=fixture({state:'denied'});assert.equal((await denied.page()).type,'PlatformUnavailable');assert.deepEqual(denied.calls,[]);
 const out=fixture({state:'signed_out'});await assert.rejects(out.page(),error=>error.redirect==='/my/access');assert.deepEqual(out.calls,[]);
 const unavailable=fixture({state:'unavailable'});assert.equal((await unavailable.page()).type,'section');assert.deepEqual(unavailable.calls,[]);
 const unavailableOut=fixture({state:'unavailable',viewer:false});assert.equal((await unavailableOut.page()).type,'PlatformUnavailable');assert.deepEqual(unavailableOut.calls,[]);
});
test('an unavailable optional welcome never takes down the member profile',async()=>{
 const f=fixture({fail:true});const tree=await f.page();assert.equal(tree.type,'MemberHome');assert.equal(tree.props.welcome,null);
 assert.deepEqual(f.calls,['member-welcome','owner']);
});
