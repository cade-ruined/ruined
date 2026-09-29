import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const Stub=()=>null;
function hooks(){let cursor=0;const slots=[],effects=[];return{effects,react:{...React,
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(effect){const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(effect);}},
},render(component,props={}){cursor=0;return component(props);}};}
function nodes(node){return React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(nodes)]:[];}
function text(node){return React.isValidElement(node)?React.Children.toArray(node.props.children).map(text).join(''):typeof node==='string'?node:'';}
async function component(name,state,fetch){const source=await readFile(new URL(`../src/components/membership/${name}.tsx`,import.meta.url),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const result={exports:{}};const deps={react:state.react,'react/jsx-runtime':jsxRuntime,'next/link':Stub,'@/components/support/supportStyles':{SUPPORT_ACTION_CLASS:'action',SUPPORT_LINK_CLASS:'link'}};
 new Function('require','module','exports','fetch',output)(name=>{assert.ok(name in deps,name);return deps[name];},result,result.exports,fetch);return result.exports.default;}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function cancellation(plan='monthly'){
 const state=hooks(),calls=[];let nextError=false;
 const renderComponent=await component('MembershipCancellation',state,async(_url,request={})=>{
  const body=request.body?JSON.parse(request.body):null;calls.push(body);
  if(!body)return{ok:true,json:async()=>({commitment:{plan,initialTermEndsAt:'2099-09-29T00:00:00Z'}})};
  if(nextError)return{ok:false,json:async()=>({error:'Your billing changed. Review a fresh quote.'})};
  if(body.action==='quote')return{ok:true,json:async()=>({quote:{id:'reviewed-quote',intent:body.intent,effectiveAt:'2099-01-01T00:00:00Z',accessThrough:body.intent==='early_exit'?'2099-01-01T00:00:00Z':null,feeDues:139800,remainingInitialDues:139800,feeTax:9087,feeTotal:148887}})};
  return{ok:true,json:async()=>({cancellation:{effectiveAt:'2099-01-01T00:00:00Z',invoiceUrl:null}})};
 });
 const render=()=>state.render(renderComponent);render();state.effects.forEach(effect=>effect());await flush();
 return{render,calls,button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),failNext:()=>{nextError=true;}};
}
test('initial monthly cancellation separates fee-free renewal stop from reviewed replacement buyout',async()=>{
 const f=await cancellation();assert.match(text(f.render()),/remaining agreed installments continue/);assert.ok(f.button('Turn off renewal'));assert.ok(f.button('Review early exit'));
 await f.button('Review early exit').props.onClick();assert.deepEqual(f.calls.at(-1),{action:'quote',intent:'early_exit'});
 assert.match(text(f.render()),/\$1,398\.00 replaces the remaining \$1,398\.00/);assert.match(text(f.render()),/Tax: \$90\.87\. Total: \$1,488\.87/);
 assert.match(text(f.render()),/No additional remaining installments will be collected/);assert.match(text(f.render()),/payment does not extend access/);
 await f.button('Confirm exit — $1,488.87').props.onClick();assert.deepEqual(f.calls.at(-1),{action:'confirm',quoteId:'reviewed-quote',confirmed:true});assert.match(text(f.render()),/Cancellation confirmed/);
});
test('annual plans have no buyout action and a member may dismiss any quote without confirmation',async()=>{
 const f=await cancellation('annual');assert.equal(f.button('Review early exit'),undefined);
 await f.button('Turn off renewal').props.onClick();assert.match(text(f.render()),/Cancellation fee: \$0/);assert.ok(f.button('Confirm renewal cancellation'));
 f.button('Keep membership').props.onClick();assert.equal(f.button('Confirm renewal cancellation'),undefined);assert.equal(f.calls.filter(call=>call?.action==='confirm').length,0);
});
test('changed cancellation data shows an error and never presents a false confirmation',async()=>{
 const f=await cancellation();await f.button('Review early exit').props.onClick();f.failNext();await f.button('Confirm exit — $1,488.87').props.onClick();
 assert.match(text(f.render()),/Your billing changed/);assert.doesNotMatch(text(f.render()),/Cancellation confirmed/);assert.ok(nodes(f.render()).some(node=>node.props.role==='alert'));
});
test('couple approval loads a targeted request and requires a separate unchecked authorization',async()=>{
 const state=hooks(),calls=[];
 const view=await component('CoupleMembershipApproval',state,async(_url,request={})=>{
  if(!request.body)return{ok:true,json:async()=>({authorization:{role:'partner',payerName:'Partner',accepted:false}})};
  calls.push(JSON.parse(request.body));return{ok:true,json:async()=>({accepted:true})};
 });
 const render=()=>state.render(view,{authorizationId:'request-id'});render();state.effects.forEach(effect=>effect());await flush();
 const checkbox=()=>nodes(render()).find(node=>node.props.type==='checkbox');
 const approve=()=>nodes(render()).find(node=>node.type==='button');
 assert.equal(checkbox().props.checked,false);assert.equal(approve().props.disabled,true);assert.match(text(render()),/does not authorize a charge to you/);
 checkbox().props.onChange({target:{checked:true}});await approve().props.onClick();
 assert.deepEqual(calls,[{action:'accept',authorizationId:'request-id',approved:true}]);assert.match(text(render()),/Couples membership approved/);
});

test('failure to load cancellation controls remains visible with retry and support instead of hiding the action',async()=>{
 const state=hooks();let fail=true;
 const view=await component('MembershipCancellation',state,async()=>({ok:!fail,json:async()=>fail?{error:'Billing is temporarily unavailable.'}:{commitment:{plan:'annual',initialTermEndsAt:'2099-01-01T00:00:00Z'}}}));
 const render=()=>state.render(view);assert.match(text(render()),/Loading cancellation options/);state.effects[0]();await flush();
 assert.match(text(render()),/Billing is temporarily unavailable/);assert.match(text(render()),/request cancellation/);
 assert.ok(nodes(render()).some(node=>node.props.href==='/my/support'));
 const retry=nodes(render()).find(node=>node.type==='button'&&text(node)==='Retry cancellation options');assert.ok(retry);
 retry.props.onClick();assert.match(text(render()),/Loading cancellation options/);
 fail=false;state.effects[0]();await flush();assert.match(text(render()),/Turn off renewal/);assert.doesNotMatch(text(render()),/Billing is temporarily unavailable/);
});
