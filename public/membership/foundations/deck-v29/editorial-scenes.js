(function () {
  'use strict';
  const scenes = window.FoundationSceneRenderers ??= {};
  const photo = (name, className = '') => `<img class="ed-photo ${className}" src="assets/figma/${name}.webp" alt="" draggable="false">`;
  const text = (copy, h, className = '') => `<p class="ed-copy ${className}">${h.esc(copy)}</p>`;
  const chosen = (index, value) => index === value ? 'true' : 'false';
  const button = (index, value, label, h, className = '') => `<button type="button" class="ed-choice ${className}" data-readable-step="${index}" aria-pressed="${chosen(index,value)}">${h.esc(label)}</button>`;
  const rail = (spec,value,h,start=0,end=spec.panels.length) => `<div class="ed-number-rail" aria-label="Choose a passage">${spec.panels.slice(start,end).map((_,i)=>button(i+start,value,h.pad(i+1),h)).join('')}</div>`;
  const split = (copy, marker, h, className='ed-emphasis') => {
    const at=copy.indexOf(marker);
    return at<0?h.esc(copy):`${h.esc(copy.slice(0,at))}<span class="${className}">${h.esc(marker)}</span>${h.esc(copy.slice(at+marker.length))}`;
  };

  scenes[2]=(spec,value,h)=>{
    const panel=spec.panels[value];
    return `<div class="editorial-scene ed-purpose" data-side="${value}"><div class="ed-purpose-choices">${spec.panels.map((p,i)=>button(i,value,p.heading,h)).join('')}</div><div class="ed-purpose-body"><span class="ed-purpose-sign" aria-hidden="true">${value===0?'↗':'+'}</span>${text(panel.copy,h)}</div></div>`;
  };

  // One field stays in place; the next part changes which connections light up.
  const originRows=[["CREATIVE WORK", "RESPONSIBILITY", "AUTOPILOT", "LOSS", "AMBITION", "ROUTINE"], ["WANTING MORE", "OVERTHINKING", "MISTAKES", "FAILURE", "CONTROL", "FEAR"], ["STARTING OVER", "COMPARISON", "DIRECTION", "PURPOSE", "IDENTITY", "CHOICE"], ["RELATIONSHIPS", "NEW IDEAS", "APPROVAL", "PATTERNS", "BUSINESS", "SPACE"], ["FEELING STUCK", "EXPLORATION", "PRESSURE", "CURIOSITY", "GROWTH", "RISK"], ["OUTGROWING", "DISCOVERY", "ADDICTION", "POSSIBILITY", "BURNOUT", "CHANGE"]];
  const originFocus=[[["CURIOSITY", "NEW IDEAS", "DISCOVERY"], ["PURPOSE", "IDENTITY", "DIRECTION"], ["CREATIVE WORK", "CHOICE", "EXPLORATION"], ["WANTING MORE", "GROWTH", "AMBITION"]], [["LOSS", "FEAR", "CHANGE"], ["RELATIONSHIPS", "APPROVAL", "CONTROL"], ["FAILURE", "COMPARISON", "MISTAKES"], ["FEELING STUCK", "ROUTINE", "AUTOPILOT"]], [["STARTING OVER", "RISK", "SPACE"], ["OUTGROWING", "BUSINESS", "RESPONSIBILITY"], ["PATTERNS", "ADDICTION", "OVERTHINKING"], ["POSSIBILITY", "PRESSURE", "BURNOUT"]]];
  const originAnchors=new Set(originFocus.flat().map(group=>group[0]));
  scenes[4]=(spec,value,h)=>{
    const panel=spec.panels[value];
    if(panel.copy)return `<div class="editorial-scene ed-origin-intro">${text(panel.copy,h,'ed-origin-declaration')}<img class="ed-photo ed-origin-art" src="assets/photoshop/straps-bracket.webp" alt="" draggable="false"></div>`;
    const focus=originFocus[value-1];
    return `<div class="editorial-scene ed-challenges" data-challenge-part="${value}"><div class="ed-challenge-field" role="list" aria-label="Challenges and reasons for change">${originRows.map((row,r)=>`<div class="ed-challenge-row" style="--row:${r}" role="presentation">${row.map(word=>{
      const phase=focus.findIndex(group=>group.includes(word));
      const primary=phase>=0&&focus[phase][0]===word;
      const classes=['ed-challenge-word',originAnchors.has(word)?'is-anchor':'',phase>=0?'is-cycling':'',primary?'is-primary':'',phase===0?'is-first':''].filter(Boolean).join(' ');
      return `<span role="listitem" class="${classes}"${phase>=0?` style="--highlight-delay:${-((4-phase)%4)*2.8}s"`:''}>${h.esc(word)}</span>`;
    }).join('')}</div>`).join('')}</div></div>`;
  };

  scenes[5]=(spec,value,h)=>{
    const panel=spec.panels[value];
    const copy=value===0?split(panel.copy,'the foundation',h):split(panel.copy,'What happens next is still ours.',h);
    return `<div class="editorial-scene ed-thesis" data-thesis="${value}"><figure class="ed-thesis-image">${photo('flowers')}</figure><p class="ed-thesis-quote">${copy}</p><span class="ed-thesis-rule" aria-hidden="true"></span></div>`;
  };

  scenes[7]=(spec,value,h)=>{
    const panel=spec.panels[value];
    return `<div class="editorial-scene ed-belonging" data-belonging="${value}"><figure class="ed-belonging-image">${photo('meadow-figure')}</figure><div class="ed-belonging-copy">${panel.heading?`<p class="ed-belonging-heading">${h.esc(panel.heading)}</p>`:''}${text(panel.copy,h)}</div></div>`;
  };

  scenes[8]=(spec,value,h)=>`<div class="editorial-scene ed-practice"><p class="ed-practice-name">${h.esc(spec.panels[value].heading)}</p><p class="ed-practice-copy">${h.esc(spec.panels[value].copy)}</p></div>`;
  scenes[9]=(spec,value,h)=>scenes[4]({panels:[{},...spec.panels]},value+1,h);

  scenes[10]=(spec,value,h)=>`<div class="editorial-scene ed-welcome" data-welcome="${value}">${photo('couch','ed-welcome-image')}<p class="ed-welcome-line">${value===1?split(spec.panels[value].copy,'Ruined starts.',h):h.esc(spec.panels[value].copy)}</p></div>`;

  scenes[11]=(spec,value,h)=>{
    if(value===0){
      const copy=spec.panels[0].copy,parts=copy.split(' ≠ ');
      return `<div class="editorial-scene ed-equation"><p class="ed-equation-input">${h.esc(parts[0])}</p><span class="ed-equation-symbol">≠</span><p class="ed-equation-answer">${h.esc(parts[1])}</p></div>`;
    }
    return `<div class="editorial-scene ed-community-build">${spec.panels.slice(1).map((p,i)=>`<button type="button" data-readable-step="${i+1}" class="ed-community-line" aria-pressed="${chosen(i+1,value)}" style="--build:${i}"><span>${h.esc(p.copy.slice(0,6))}</span><strong>${h.esc(p.copy.slice(7))}</strong><i aria-hidden="true">${i+1===value?'↗':'+'}</i></button>`).join('')}</div>`;
  };

  scenes[15]=(spec,value,h)=>{
    const panel=spec.panels[value];
    return `<div class="editorial-scene ed-founder-file" data-file="${value}"><figure class="ed-file-image">${photo('archive-wall')}</figure><div class="ed-file-copy">${value===0?text(panel.copy,h,'ed-placeholder'):`<span class="ed-file-number" aria-hidden="true">${h.pad(value)}</span>${text(panel.copy,h,'ed-file-question')}`}</div>${rail(spec,value,h,1)}</div>`;
  };

  scenes[21]=(spec,value,h)=>{
    const panel=spec.panels[value];
    return `<div class="editorial-scene ed-timeline-invitation"><p class="ed-timeline-question">${h.esc(panel.heading)}</p><p class="ed-timeline-guidance">${h.esc(panel.copy)}</p></div>`;
  };

  scenes[22]=(spec,value,h)=>{
    const panel=spec.panels[value];
    if(panel.items)return `<div class="editorial-scene ed-category-lens"><ul>${panel.items.map(item=>`<li class="${item.length>21?'ed-category-long':''}">${h.esc(item)}</li>`).join('')}</ul></div>`;
    return `<div class="editorial-scene ed-category-intro">${photo('shutter-wall','ed-category-image')}${text(panel.copy,h)}<span class="ed-category-arrow" aria-hidden="true">↗</span></div>`;
  };

  scenes[29]=(spec,value,h)=>{
    const panel=spec.panels[value];
    return `<div class="editorial-scene ed-reflection" data-reflection="${value}"><span class="ed-question-mark" aria-hidden="true">?</span>${text(panel.copy,h,'ed-reflection-question')}</div>`;
  };

  scenes[32]=(spec,value,h)=>{
    const panel=spec.panels[value];
    const mark=['What happened','What you made it mean','changing either one.','see the difference.'][value];
    return `<div class="editorial-scene ed-poem" data-verse="${value}"><p class="ed-verse">${split(panel.copy,mark,h)}</p></div>`;
  };

  scenes[33]=(spec,value,h)=>{
    const panel=spec.panels[value];
    return `<div class="editorial-scene ed-finish">${text(panel.copy,h,'ed-curiosity')}<span class="ed-finish-mark" aria-hidden="true">↗</span></div>`;
  };

  scenes[34]=(spec,value,h)=>{
    const panel=spec.panels[value];
    const backdrop=`<div class="ed-storm-image">${window.FoundationStormMarkup(true)}</div>`;
    if(panel.kind==='recap'){
      const groups=panel.groups.map(group=>`<section class="ed-recap-group"><h3>${h.esc(group.heading)}</h3><ul>${group.items.map(item=>`<li>${h.esc(item)}</li>`).join('')}</ul></section>`).join('');
      return `<div class="editorial-scene ed-finale" data-final="${value}">${backdrop}<div class="ed-finale-recap"><h2>${h.esc(panel.heading)}</h2><div class="ed-recap-groups">${groups}</div></div></div>`;
    }
    const title=value===0?'<h2 class="ed-foundations-title">FOUNDATIONS 2</h2>':'';
    return `<div class="editorial-scene ed-finale" data-final="${value}">${backdrop}<div class="ed-finale-message">${title}<p class="ed-finale-copy">${h.esc(panel.copy)}</p></div></div>`;
  };
})();
