import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const Practice = () => null, Notice = () => null, Unavailable = () => null;
const component = value => ({ __esModule: true, default: value });

function fixture({ state='authenticated', write=true, revisit=false, fail=false }={}) {
  const calls=[];
  const snapshot={ownerId:'account-a',revision:'8',canWrite:write,releases:{f1:true,f2:false,f3:false,f4:false,time:false}};
  const deps={
    'next/navigation':{redirect:href=>{throw Error(`redirect:${href}`)}},
    '@/components/membership/MemberAccessNotice':component(Notice),
    '@/components/membership/MemberPractice':component(Practice),
    '@/components/platform/PlatformUnavailable':component(Unavailable),
    '@/lib/membership/access-policy':{deriveMemberAccessPolicy:()=>({}),memberCan:(_,cap)=>cap==='foundations.write'?write:revisit},
    '@/lib/membership/page-context':{getMembershipPageContext:async()=>({state,data:['signed_out','denied','unavailable'].includes(state)?null:{},viewer:{authUserId:'account-a'}})},
    '@/lib/membership/preview':{PREVIEW_MEMBER_IDENTITY:{}},
    '@/lib/membership/repository':{getMemberIdentity(){}},
    '@/lib/practice/model':{PRACTICE_COURSES:['f1','f2','f3','f4','time'],previewPracticeSnapshot:()=>({...snapshot,ownerId:'preview',canWrite:false})},
    '@/lib/practice/repository':{getMemberPracticeSnapshot:async owner=>{calls.push(owner);if(fail)throw Error('Unavailable');return snapshot;}},
  };
  const source=readFileSync(new URL('../app/my/practice/page.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)(name=>name==='react/jsx-runtime'?require(name):deps[name]??(()=>{throw Error(`Unexpected ${name}`)})(),mod,mod.exports);
  return {calls,snapshot,render:query=>mod.exports.default({searchParams:Promise.resolve(query??{})})};
}

test('Practice enforces member session and entitlement before loading any account work',async()=>{
  const signedOut=fixture({state:'signed_out'});
  await assert.rejects(signedOut.render(),/redirect:\/my\/access/);
  assert.deepEqual(signedOut.calls,[]);
  for(const state of ['denied','unavailable']){const f=fixture({state});assert.equal((await f.render()).type,Unavailable);assert.deepEqual(f.calls,[]);}
  const denied=fixture({write:false});assert.equal((await denied.render()).type,Notice);assert.deepEqual(denied.calls,[]);
});

test('eligible members receive their own server snapshot without Circle placement as a prerequisite',async()=>{
  const f=fixture(),page=await f.render({course:'f1'});
  assert.equal(page.type,Practice);assert.equal(page.key,'account-a');assert.equal(page.props.initial,f.snapshot);
  assert.equal(page.props.connected,true);assert.equal(page.props.initialCourse,'f1');assert.deepEqual(f.calls,['account-a']);
});

test('future course deep links never alter server release flags',async()=>{
  const f=fixture(),page=await f.render({area:'monthly',course:'time'});
  assert.equal(page.props.initialArea,'monthly');assert.equal(page.props.initialCourse,'time');
  assert.equal(page.props.initial.releases.time,false);
  const unknown=await f.render({course:'../../account'});assert.equal(unknown.props.initialCourse,undefined);
});

test('revisit access retains read-only state and preview never reads member storage',async()=>{
  const revisit=fixture({write:false,revisit:true}),page=await revisit.render();
  assert.equal(page.type,Practice);assert.equal(page.props.initial.canWrite,false);
  const preview=fixture({state:'preview'}),local=await preview.render();
  assert.equal(local.props.connected,false);assert.equal(local.props.initial.ownerId,'preview');assert.deepEqual(preview.calls,[]);
});

test('a failed account read offers recovery instead of an empty writable assignment',async()=>{
  const f=fixture({fail:true});const original=console.error;console.error=()=>{};
  try {const page=await f.render();assert.equal(page.type,'section');assert.notEqual(page.type,Practice);}finally{console.error=original;}
});
