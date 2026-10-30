(function(){
  'use strict';
  const registry=window.FoundationExperiments??={};
  const clamp=v=>Math.max(0,Math.min(100,Number(v)||0));
  const lerp=(a,b,t)=>a+(b-a)*t;
  // The same four units move from one fixed column into an open editorial arrangement.
  const closed=[[0,0,63,25,5.35],[0,25,63,25,5.35],[0,50,63,25,5.35],[0,75,63,25,5.35]];
  const opened=[[2,4,23,27,4.8],[28,0,70,48,12],[7,61,22,33,5.8],[34,51,64,46,11.8]];
  function render(c){return `<section class="scene experiment purpose-experiment" aria-labelledby="sceneTitle" data-purpose-scene>
    <div class="pp-green" aria-hidden="true"></div>
    <header class="pp-head"><div class="er-hidden-heading"><p>${c.esc(c.source.kicker)}</p><h1 id="sceneTitle">${c.esc(c.source.title)}</h1></div><button data-purpose-why aria-expanded="false">WHY ↗</button></header>
    <div class="pp-body"><div class="pp-composition" data-purpose-field role="slider" tabindex="0" aria-label="Transform the life we know into the life we imagine" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-describedby="purposeInstruction" data-no-swipe>
      <div class="pp-known-grid" aria-hidden="true"></div>
      <img class="pp-straps" data-purpose-straps src="assets/photoshop/straps-bracket.webp" alt="" draggable="false">
      ${['THE','LIFE','WE','KNOW'].map((w,i)=>`<div class="pp-piece" data-purpose-piece="${i}" aria-hidden="true"><div class="pp-material"></div><span class="pp-word ${i===3?'pp-known-word':''}">${w}</span>${i===3?'<span class="pp-word pp-imagined-word">IMAGINE</span>':''}</div>`).join('')}
      <span class="pp-drag-hint" id="purposeInstruction">DRAG TO RECOMPOSE ↔</span>
    </div><div class="pp-controls" data-no-swipe><div class="pp-endpoints"><button data-purpose-end="0" aria-pressed="true">${c.esc(c.source.texts[5])}</button><button data-purpose-end="100" aria-pressed="false">${c.esc(c.source.texts[6])}</button></div><input type="range" data-purpose-range min="0" max="100" step="1" value="0" aria-label="Life we know to life we imagine"></div></div>
    <dialog class="pp-dialog" data-purpose-dialog aria-labelledby="purposeWhy"><header><h2 id="purposeWhy">${c.esc(c.source.title)}</h2><button data-purpose-close aria-label="Close explanation">×</button></header><p>${c.esc(c.source.texts[2])}</p><p>${c.esc(c.source.texts[3])}</p><p>${c.esc(c.source.texts[4])}</p></dialog>
  </section>`;}
  function bind(c){
    const field=c.root.querySelector('[data-purpose-field]'),range=c.root.querySelector('[data-purpose-range]'),dialog=c.root.querySelector('[data-purpose-dialog]'),why=c.root.querySelector('[data-purpose-why]');
    range.addEventListener('input',e=>{c.root.querySelector('[data-purpose-scene]').classList.remove('is-morphing');c.set({progress:Number(e.currentTarget.value)});});
    c.root.querySelectorAll('[data-purpose-end]').forEach(b=>b.addEventListener('click',()=>{c.root.querySelector('[data-purpose-scene]').classList.add('is-morphing');c.set({progress:Number(b.dataset.purposeEnd)});}));
    why.addEventListener('click',()=>c.set({context:1}));
    c.root.querySelector('[data-purpose-close]').addEventListener('click',()=>c.set({context:0}));
    dialog.addEventListener('cancel',e=>{e.preventDefault();c.set({context:0});});
    dialog.addEventListener('close',()=>{if(c.state.context)c.set({context:0});why.focus({preventScroll:true});});
    let drag=null;
    field.addEventListener('pointerdown',e=>{
      if(e.button!==0&&e.pointerType!=='touch')return;
      e.preventDefault();c.root.querySelector('[data-purpose-scene]').classList.remove('is-morphing');field.focus({preventScroll:true});
      drag={id:e.pointerId,x:e.clientX,start:clamp(c.state.progress),travel:Math.max(1,field.getBoundingClientRect().width*.7)};
      field.setPointerCapture(e.pointerId);field.classList.add('is-dragging');
    });
    field.addEventListener('pointermove',e=>{if(drag&&e.pointerId===drag.id)c.set({progress:clamp(drag.start+(e.clientX-drag.x)/drag.travel*100)});});
    const end=e=>{if(!drag||e.pointerId!==drag.id)return;drag=null;field.classList.remove('is-dragging');if(field.hasPointerCapture(e.pointerId))field.releasePointerCapture(e.pointerId);};
    field.addEventListener('pointerup',end);field.addEventListener('pointercancel',end);field.addEventListener('lostpointercapture',()=>{drag=null;field.classList.remove('is-dragging');});
    field.addEventListener('keydown',e=>{
      let p=clamp(c.state.progress);
      if(e.key==='ArrowRight'||e.key==='ArrowUp')p+=5;
      else if(e.key==='ArrowLeft'||e.key==='ArrowDown')p-=5;
      else if(e.key==='Home')p=0;
      else if(e.key==='End')p=100;
      else return;
      e.preventDefault();e.stopPropagation();c.root.querySelector('[data-purpose-scene]').classList.remove('is-morphing');c.set({progress:clamp(p)});
    });
  }
  function paint(c){
    const p=clamp(c.state.progress),t=p/100,scene=c.root.querySelector('[data-purpose-scene]'),field=c.root.querySelector('[data-purpose-field]');
    if(p>0&&p<100)scene.classList.remove('is-morphing');
    scene.style.setProperty('--pp-progress',String(t));
    scene.style.setProperty('--pp-ink',t<.3?'#eee9dd':'#1d221c');
    c.root.querySelectorAll('[data-purpose-piece]').forEach((el,i)=>{
      const a=closed[i],b=opened[i];
      ['left','top','width','height'].forEach((key,k)=>el.style[key]=`${lerp(a[k],b[k],t)}%`);
      el.style.setProperty('--pp-font',String(lerp(a[4],b[4],t)));
      el.style.setProperty('--pp-mobile-font',String(lerp(54,[38,87,44,63][i],t)));
    });
    const description=p===0?'The life we know. A fixed arrangement.':p===100?'The life we imagine. The same elements, arranged another way.':`${Math.round(p)} percent. The fixed arrangement is opening into another possibility.`;
    field.setAttribute('aria-valuenow',String(Math.round(p)));field.setAttribute('aria-valuetext',description);
    const range=c.root.querySelector('[data-purpose-range]');range.value=String(p);range.setAttribute('aria-valuetext',description);
    c.root.querySelectorAll('[data-purpose-end]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.purposeEnd)===p)));
    const dialog=c.root.querySelector('[data-purpose-dialog]'),open=c.state.context>=.5;
    c.root.querySelector('[data-purpose-why]').setAttribute('aria-expanded',String(open));
    if(open&&!dialog.open)dialog.showModal();else if(!open&&dialog.open)dialog.close();
  }
  registry[4]={defaults:{progress:0,context:0},ranges:{progress:[0,100],context:[0,1]},render,bind,paint};
  window.FoundationPurposeAudit={closed,opened};
})();
