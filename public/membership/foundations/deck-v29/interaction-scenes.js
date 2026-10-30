(function () {
  'use strict';
  const registry = window.FoundationSceneRenderers ??= {};
  const ids = [6,12,13,17,19,20,24,25,26,27,31];
  const labelText = panel => panel.heading || panel.copy || (panel.items || []).join(', ');
  function segments(spec, value, h, count=spec.panels.length, cls='') {
    return `<nav class="fsi-segments ${cls}" aria-label="Choose a part">${spec.panels.slice(0,count).map((panel,i)=>`<button type="button" data-readable-step="${i}" aria-pressed="${i===value}" aria-label="${h.esc(labelText(panel))}"><span>${h.pad(i+1)}</span><i aria-hidden="true"></i></button>`).join('')}</nav>`;
  }
  function statement(panel,h,cls='') {
    return `<div class="fsi-statement ${cls}"><p class="fsi-source-copy">${h.esc(panel.copy)}</p></div>`;
  }
  function groupTabs(spec,value,h,cls='') {
    const groups=[];
    spec.panels.forEach((panel,i)=>{if(panel.heading&&!groups.some(group=>group.heading===panel.heading))groups.push({heading:panel.heading,index:i});});
    return `<nav class="fsi-group-tabs ${cls}" aria-label="Choose a perspective">${groups.map(group=>`<button type="button" data-readable-step="${group.index}" aria-pressed="${spec.panels[value].heading===group.heading}">${h.esc(group.heading)}</button>`).join('')}</nav>`;
  }
  registry[6]=(spec,value,h)=>{
    const panel=spec.panels[value],negative=panel.heading==='RUINED IS NOT';
    return `<div class="fsi-scene fsi-definition ${negative?'is-not':'is-recognizes'}">${groupTabs(spec,value,h)}<div class="fsi-definition-body"><span class="fsi-definition-mark" aria-hidden="true">${negative?'≠':'='}</span><ul class="fsi-definition-list">${panel.items.map(text=>`<li class="fsi-source-copy">${h.esc(text)}</li>`).join('')}</ul></div></div>`;
  };
  registry[12]=(spec,value,h)=>{
    const panel=spec.panels[value];
    return `<div class="fsi-scene fsi-manifesto"><div class="fsi-manifesto-main"><div class="fsi-manifesto-copy"><p class="fsi-source-heading">${h.esc(panel.heading)}</p><p class="fsi-source-copy">${h.esc(panel.copy)}</p></div></div></div>`;
  };
  function chain(spec,value,h) {
    const panel=spec.panels[value],last=value===spec.panels.length-1;
    const rail=segments(spec,value,h,spec.panels.length,'fsi-chain-rail');
    if(last)return `<div class="fsi-scene fsi-chain is-conclusion">${statement(panel,h)}${rail}</div>`;
    const type=panel.heading.replace(/\s/g,'').length<9?13:10.2;
    return `<div class="fsi-scene fsi-chain" style="--chain-type:${type}cqw"><div class="fsi-chain-main"><span class="fsi-chain-arrow" aria-hidden="true">→</span><div><p class="fsi-source-heading">${h.esc(panel.heading)}</p><p class="fsi-source-copy">${h.esc(panel.copy)}</p></div></div>${rail}</div>`;
  }
  registry[13]=chain;
  registry[17]=chain;
  function eventStory(spec,value,h) {
    const panel=spec.panels[value];
    if(!panel.context){
      if(panel.heading)return `<div class="fsi-scene fsi-event-story is-event"><p class="fsi-event-label">${h.esc(panel.heading)}</p><p class="fsi-event-alone fsi-source-copy">${h.esc(panel.copy)}</p>${segments(spec,value,h)}</div>`;
      return `<div class="fsi-scene fsi-event-story is-instruction">${statement(panel,h)}${segments(spec,value,h)}</div>`;
    }
    const length=panel.copy.length,type=length<=18?10.5:length<=26?9.4:length<=34?8.4:7.8;
    return `<div class="fsi-scene fsi-event-story is-story"><div class="fsi-event-anchor"><p class="fsi-event-label">${h.esc(panel.heading)}</p><p class="fsi-source-context">${h.esc(panel.context)}</p><span aria-hidden="true">●</span></div><div class="fsi-story-paper" style="--story-offset:${(value%3)-1};--story-type:${type}cqw"><span class="fsi-story-quote" aria-hidden="true">“</span><p class="fsi-source-copy">${h.esc(panel.copy)}</p></div>${segments(spec,value,h)}</div>`;
  }
  registry[19]=eventStory;
  registry[20]=eventStory;
  registry[24]=eventStory;
  registry[25]=(spec,value,h)=>{
    const panel=spec.panels[value];
    if(!panel.items)return `<div class="fsi-scene fsi-belief is-instruction">${statement(panel,h)}${segments(spec,value,h)}</div>`;
    const type=Math.max(...panel.items.map(text=>text.length))>20?4.8:6.2;
    return `<div class="fsi-scene fsi-belief" style="--effect-type:${type}cqw"><div class="fsi-belief-origin"><p class="fsi-source-heading">${h.esc(panel.heading)}</p><span aria-hidden="true">↓</span></div><ul class="fsi-belief-effects">${panel.items.map((text,i)=>`<li class="fsi-source-copy" style="--effect:${i}">${h.esc(text)}</li>`).join('')}</ul>${segments(spec,value,h)}</div>`;
  };
  registry[26]=(spec,value,h)=>{
    const panel=spec.panels[value];
    if(!panel.heading)return `<div class="fsi-scene fsi-then-now is-conclusion">${statement(panel,h)}${segments(spec,value,h)}</div>`;
    const isNow=panel.heading==='NOW',pair=value%2;
    return `<div class="fsi-scene fsi-then-now ${isNow?'is-now':'is-then'}"><nav class="fsi-time-switch" aria-label="Compare then and now"><button type="button" data-readable-step="${pair}" aria-pressed="${!isNow}">${h.esc(spec.panels[0].heading)}</button><span aria-hidden="true">↔</span><button type="button" data-readable-step="${pair+2}" aria-pressed="${isNow}">${h.esc(spec.panels[2].heading)}</button></nav><div class="fsi-time-statement"><span class="fsi-time-rule" aria-hidden="true"></span><p class="fsi-source-copy">${h.esc(panel.copy)}</p></div><nav class="fsi-time-pairs" aria-label="Choose an example"><button type="button" data-readable-step="${isNow?2:0}" aria-pressed="${pair===0}" aria-label="Parents' divorce example">01</button><button type="button" data-readable-step="${isNow?3:1}" aria-pressed="${pair===1}" aria-label="Business example">02</button><button type="button" data-readable-step="4" aria-label="Continue to the final reflection">→</button></nav></div>`;
  };
  registry[27]=(spec,value,h)=>{
    const panel=spec.panels[value];
    return `<div class="fsi-scene fsi-pattern"><div class="fsi-pattern-field"><div class="fsi-pattern-echo" aria-hidden="true">${h.esc(panel.copy)}</div><p class="fsi-source-copy">${h.esc(panel.copy)}</p><div class="fsi-pattern-echo second" aria-hidden="true">${h.esc(panel.copy)}</div></div>${segments(spec,value,h)}</div>`;
  };
  registry[31]=(spec,value,h)=>{
    const panel=spec.panels[value];
    return `<div class="fsi-scene fsi-recap">${groupTabs(spec,value,h)}<div class="fsi-recap-main"><span class="fsi-recap-bracket" aria-hidden="true">[</span><ul>${panel.items.map(text=>`<li class="fsi-source-copy">${h.esc(text)}</li>`).join('')}</ul><span class="fsi-recap-bracket closing" aria-hidden="true">]</span></div></div>`;
  };
  window.FoundationInteractionSceneIds = ids;
})();
