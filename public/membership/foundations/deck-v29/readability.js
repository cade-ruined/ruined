(function () {
  'use strict';
  const base = {
    render: window.renderFoundation,
    bind: window.bindFoundation,
    cleanup: window.cleanupFoundation,
    advance: window.advanceFoundation,
    canAdvance: window.canAdvanceFoundation,
    apply: window.applyFoundationInteraction,
    get: window.getFoundationInteraction
  };
  const owned = new Set([2,4,5,6,7,8,9,10,11,12,13,15,17,19,20,21,22,24,25,26,27,29,31,32,33,34]);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const lines = value => String(value ?? '').split(/\n+/).filter(Boolean);
  const chunk = (items, size) => Array.from({length:Math.ceil(items.length / size)}, (_,i) => items.slice(i * size, (i + 1) * size));
  const pad = value => String(value).padStart(2, '0');
  let activeIndex = -1;
  let step = 0;
  let activeSpec = null;

  function specification(index) {
    const s = window.FOUNDATIONS[index];
    const t = s.texts;
    const n = index + 1;
    const spec = { index, title:s.title, kicker:s.kicker || t[0], theme:'paper', scenery:'paper', accent:null, panels:[] };
    const add = (kind, fields) => spec.panels.push({kind, ...fields});
    const statement = (copy, kind='statement') => add(kind, {copy});
    const phrase = copy => add('phrase', {copy});
    const rule = (heading, copy, fields={}) => add('rule', {heading,copy,...fields});
    const words = (items, heading) => add('words', {items,heading});
    const grouped = (heading, text, count=3) => chunk(lines(text), count).forEach(items => words(items, heading));
    const example = (eventLabel, event, stories) => lines(stories).forEach((copy,i) => add('example',{heading:eventLabel,context:event,copy,ordinal:i+1}));
    switch(n) {
      case 2:
        spec.accent='collage'; rule(t[2],t[3]);rule(t[4],t[5]);break;
      case 4:
        spec.theme='dark';spec.scenery='black-texture';statement(t[2]);chunk(t.slice(3),3).forEach(items=>words(items));break;
      case 5:
        spec.theme='dark';spec.scenery='flowers';statement(t[2],'quote');statement(t[3]);break;
      case 6:
        grouped(t[2],t[3]);grouped(t[4],t[5]);break;
      case 7:
        spec.accent='frame-1167-366';lines(t[2]).forEach(text=>statement(text));rule(t[3],t[4]);break;
      case 8:
        spec.theme='sage';spec.scenery='sage-paper';for(let i=2;i<t.length;i+=2)rule(t[i],t[i+1]);break;
      case 9:
        spec.theme='dark';spec.scenery='black-texture';chunk(t.slice(2),12).forEach(items=>words(items));break;
      case 10:
        spec.theme='dark';spec.scenery='couch';lines(t[2]).forEach(text=>statement(text));statement(t[3]);break;
      case 11:
        statement(t[2]);t.slice(3).forEach(text=>phrase(text));break;
      case 12:
        for(let i=2;i<t.length;i+=2)rule(t[i],t[i+1],{ordinal:(i/2)});break;
      case 13:{
        spec.theme='sage';spec.scenery='sage-paper';
        const clean=t.slice(2,-1).filter(text=>text!=='→');
        for(let i=0;i<clean.length;i+=2)rule(clean[i],clean[i+1],{ordinal:i/2+1});
        statement(t.at(-1));break;
      }
      case 15:
        spec.accent='archive-folders';statement(t[2]);t.slice(3).forEach(text=>phrase(text));break;
      case 17:{
        spec.theme='sage';spec.scenery='sage-paper';spec.accent='yellow-lines-original';
        const clean=t.slice(2,-1).filter(text=>text!=='→');
        for(let i=0;i<clean.length;i+=2)rule(clean[i],clean[i+1],{ordinal:i/2+1});
        statement(t.at(-1));break;
      }
      case 19:case 20:
        spec.accent='archive-folders';rule(t[2],t[3]);example(t[2],t[3],t[4]);break;
      case 21:
        spec.theme='dark';spec.scenery='black-texture';rule(t[2],t[3]);break;
      case 22:
        statement(t[2]);chunk(t.slice(3,-1),4).forEach(items=>words(items));statement(t.at(-1));break;
      case 24:
        spec.accent='archive-folders';statement(t[2]);example(t[3],t[4],t[5]);break;
      case 25:
        statement(t[2]);grouped(t[3],t[4]);grouped(t[5],t[6]);break;
      case 26:
        lines(t[3]).forEach(copy=>rule(t[2],copy));lines(t[5]).forEach(copy=>rule(t[4],copy));statement(t[6]);break;
      case 27:
        spec.theme='dark';spec.scenery='black-texture';t.slice(2).forEach(text=>phrase(text));break;
      case 29:
        lines(t[2]).forEach((copy,i)=>add('question',{copy,ordinal:i+1}));statement(t[3]);break;
      case 31:
        grouped(t[2],t[3]);grouped(t[4],t[5]);break;
      case 32:
        spec.kicker='';String(t[0]).split(/\n\n+/).forEach(copy=>statement(copy,'quote'));break;
      case 33:
        phrase(t[2]);break;
      case 34:
        spec.theme='dark';spec.scenery='frame-1163-357';statement(t[2]);statement(t[3],'quote');add('recap',{heading:t[4],groups:[{heading:t[5],items:lines(t[6])},{heading:t[7],items:lines(t[8])}]});break;
    }
    return spec;
  }

  function markup(spec, value) {
    const panel=spec.panels[value];
    const number=spec.index+1;
    const renderer=window.FoundationSceneRenderers?.[number];
    const visibleHeading=[9,12,22].includes(number);
    const audienceTitle=number===12?'Community agreements':spec.title;
    const sceneClass=`scene readable ${visibleHeading?'er-with-heading':'er-unframed'} readable--${spec.theme} readable-slide-${number} readable-kind-${panel.kind}${renderer?' refined':''}`;
    const image=`<img class="readable-scenery" src="assets/figma/${esc(spec.scenery)}.webp" alt="" draggable="false">`;
    const accent=spec.accent?`<img class="readable-art" src="assets/figma/${esc(spec.accent)}.webp" alt="" draggable="false">`:'';
    const ordinal=panel.ordinal?`<span class="readable-ordinal" aria-hidden="true">${pad(panel.ordinal)}</span>`:'';
    const heading=panel.heading?`<p class="readable-label">${esc(panel.heading)}</p>`:'';
    const context=panel.context?`<p class="readable-context">${esc(panel.context)}</p>`:'';
    const items=panel.items?`<ul class="readable-words">${panel.items.map(text=>`<li class="readable-copy">${esc(text)}</li>`).join('')}</ul>`:'';
    const copy=panel.copy?`<p class="${panel.kind==='phrase'?'readable-phrase':'readable-copy'}">${esc(panel.copy)}</p>`:'';
    const composition=renderer?renderer(spec,value,{esc,pad}):`${ordinal}<div class="readable-panel-copy">${heading}${context}${items}${copy}</div>`;
    const dots=spec.panels.map((item,i)=>`<button type="button" class="readable-dot" data-readable-step="${i}" aria-label="Part ${i+1} of ${spec.panels.length}" aria-pressed="${i===value}"><span></span></button>`).join('');
    return `<section class="${sceneClass}" aria-labelledby="sceneTitle" data-source-slide="${number}" data-panel="${value}" data-panel-count="${spec.panels.length}">${image}${accent}<header class="readable-head${visibleHeading?'':' er-hidden-heading'}"><h1 class="readable-title" id="sceneTitle">${esc(audienceTitle)}</h1></header><div class="readable-panel" aria-live="polite">${composition}</div><nav class="readable-transport" aria-label="Slide parts"><button type="button" data-readable-direction="-1"${value===0?' disabled':''} aria-label="Previous part">←</button><div class="readable-dots">${dots}</div><span class="readable-part-count">${pad(value+1)} / ${pad(spec.panels.length)}</span><button type="button" data-readable-direction="1"${value===spec.panels.length-1?' disabled':''} aria-label="Next part">→</button></nav></section>`;
  }

  function bindPanel() {
    document.querySelectorAll('[data-readable-step]').forEach(button=>{
      button.onclick=()=>setStep(Number(button.dataset.readableStep),true);
    });
    document.querySelectorAll('[data-readable-direction]').forEach(button=>{
      button.onclick=()=>setStep(step+Number(button.dataset.readableDirection),true);
    });
    document.querySelectorAll('[data-readable-range]').forEach(input=>{
      input.onchange=e=>setStep(Number(e.currentTarget.value),true);
    });
  }

  function setStep(value, emit) {
    if(!activeSpec || !Number.isFinite(Number(value)))return false;
    const next=Math.max(0,Math.min(activeSpec.panels.length-1,Math.trunc(Number(value))));
    if(next===step)return false;
    step=next;
    const stage=document.querySelector('#stage');
    if(stage){stage.innerHTML=markup(activeSpec,step);stage.scrollTop=0;stage.scrollLeft=0;}
    bindPanel();
    if(emit)document.dispatchEvent(new CustomEvent('foundations:interaction',{detail:{slide:activeIndex,value:{step}}}));
    return true;
  }

  window.renderFoundation=function(index) {
    activeIndex=index;
    step=0;
    activeSpec=owned.has(index+1)?specification(index):null;
    return activeSpec?markup(activeSpec,0):base.render(index);
  };
  window.bindFoundation=function(index) {
    if(!owned.has(index+1))return base.bind?.(index);
    activeIndex=index;
    activeSpec=specification(index);
    step=0;
    bindPanel();
  };
  window.cleanupFoundation=function(){base.cleanup?.();};
  window.canAdvanceFoundation=function(delta) {
    if(!activeSpec)return base.canAdvance?.(delta)===true;
    return delta>0?step<activeSpec.panels.length-1:delta<0?step>0:false;
  };
  window.advanceFoundation=function(delta) {
    if(!activeSpec)return base.advance?.(delta)===true;
    if(!window.canAdvanceFoundation(delta))return false;
    return setStep(step+(delta>0?1:-1),true);
  };
  window.getFoundationInteraction=function(){return activeSpec?{step}:base.get?.() ?? null;};
  window.applyFoundationInteraction=function(value) {
    if(!activeSpec)return base.apply?.(value);
    if(value && Object.prototype.hasOwnProperty.call(value,'step'))setStep(value.step,false);
  };
  // Read-only audit access: every panel can be rendered without a browser.
  window.FoundationsReadability={ownedSlides:[...owned],specification,markup};
})();
