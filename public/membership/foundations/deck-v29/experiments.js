(function(){
 'use strict';
 const base={render:window.renderFoundation,bind:window.bindFoundation,cleanup:window.cleanupFoundation,advance:window.advanceFoundation,canAdvance:window.canAdvanceFoundation,get:window.getFoundationInteraction,apply:window.applyFoundationInteraction};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pad=n=>String(n).padStart(2,'0');
 let active=null,ctx=null;
 function normalize(entry,value,previous=entry.defaults){
  const state={};
  for(const key of Object.keys(entry.defaults)){
   const v=typeof value?.[key]==='number'&&Number.isFinite(value[key])?value[key]:previous[key];
   const range=entry.ranges?.[key]??[-100000,100000];
   state[key]=Math.max(range[0],Math.min(range[1],v));
  }
  return state;
 }
 function set(patch,emit=true){
  if(!active||!ctx)return;
  const next=normalize(active,patch,ctx.state);
  if(Object.keys(next).every(key=>next[key]===ctx.state[key]))return;
  Object.assign(ctx.state,next);
  active.paint?.(ctx);
  if(emit)document.dispatchEvent(new CustomEvent('foundations:interaction',{detail:{slide:ctx.n-1,value:{experiment:{...ctx.state}}}}));
 }
 window.renderFoundation=function(index){
  active=window.FoundationExperiments?.[index+1]??null;
  ctx=active?{n:index+1,source:window.FOUNDATIONS[index],state:normalize(active,active.defaults),root:null,esc,pad,set:patch=>set(patch,true)}:null;
  return active?active.render(ctx):base.render(index);
 };
 window.bindFoundation=function(index){
  if(!active)return base.bind?.(index);
  ctx.root=document.querySelector('#stage');
  active.bind?.(ctx);
  active.paint?.(ctx);
 };
 window.cleanupFoundation=function(){if(active&&ctx)active.dispose?.(ctx);base.cleanup?.();};
 window.canAdvanceFoundation=delta=>active?active.canAdvance?.(ctx,delta)===true:base.canAdvance?.(delta)===true;
 window.advanceFoundation=delta=>active?active.advance?.(ctx,delta)===true:base.advance?.(delta)===true;
 window.getFoundationInteraction=()=>active?{experiment:{...ctx.state}}:base.get?.()??null;
 window.applyFoundationInteraction=value=>active?set(value?.experiment??{},false):base.apply?.(value);
 window.FoundationExperimentAudit={normalize,ids:()=>Object.keys(window.FoundationExperiments??{}).map(Number)};
})();
