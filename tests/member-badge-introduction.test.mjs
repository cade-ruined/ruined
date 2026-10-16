import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../app/my/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function fixture({state='authenticated',seen=false,fail=false}={}){
 const calls=[], member={artifact:null,artifacts:[]};
 const deps={
  'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  'next/navigation':{redirect:path=>{throw {redirect:path};}},
  '@/components/platform/MemberHome':{default:'MemberHome'},
  '@/components/platform/PlatformUnavailable':{default:'PlatformUnavailable'},
  '@/lib/database/server':{withFreshApplicationDatabaseRead:async(name,read)=>{calls.push(name);return read();}},
  '@/lib/membership/artifact-products':{resolveMemberHomeArtifactProducts:member=>member},
  '@/lib/membership/badge-collection-repository':{shouldIntroduceMemberBadges:async id=>{calls.push(id);if(fail)throw Error('temporary failure');return !seen;}},
  '@/lib/membership/page-context':{getMembershipPageContext:async()=>({state,viewer:state==='preview'?null:{authUserId:'owner'},data:['authenticated','preview'].includes(state)?member:null})},
  '@/lib/membership/preview':{PREVIEW_MEMBER_HOME:member},
  '@/lib/membership/repository':{getMemberHome:async()=>member},
  '@/lib/shopify':{getProducts:async()=>[]},
 };
 const loaded={exports:{}};
 new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},loaded,loaded.exports);
 return {page:loaded.exports.default,calls};
}
test('profile introduces unseen badges only after normal authenticated member page access',async()=>{
 const f=fixture();await assert.rejects(f.page(),error=>error.redirect==='/my/badges?welcome=1');
 assert.deepEqual(f.calls,['member-badge-introduction','owner']);
 const seen=fixture({seen:true});assert.equal((await seen.page()).type,'MemberHome');
 const preview=fixture({state:'preview'});assert.equal((await preview.page()).type,'MemberHome');assert.deepEqual(preview.calls,[]);
 const denied=fixture({state:'denied'});assert.equal((await denied.page()).type,'PlatformUnavailable');assert.deepEqual(denied.calls,[]);
 const out=fixture({state:'signed_out'});await assert.rejects(out.page(),error=>error.redirect==='/my/access');assert.deepEqual(out.calls,[]);
});
test('an unavailable optional introduction never takes down the member profile',async()=>{
 const f=fixture({fail:true});assert.equal((await f.page()).type,'MemberHome');
});
