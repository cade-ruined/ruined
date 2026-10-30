(function () {
  'use strict';
  const entries = window.FoundationExperiments ??= {};
  const clamp = (value,min,max) => Math.max(min,Math.min(max,Number(value)||0));
  const pairs = source => {
    const words=source.texts.slice(2,-1).filter(text=>text!=='→');
    return Array.from({length:Math.floor(words.length/2)},(_,i)=>({name:words[i*2],description:words[i*2+1]}));
  };
  const header = (ctx,extra='',keepTitle=false) => `<header class="ex-head${keepTitle?'':' er-hidden-heading'}"><p class="ex-overline ex-kicker${keepTitle?' er-hidden-heading':''}">${ctx.esc(ctx.source.kicker || ctx.source.texts[0])}${extra?` <span>${ctx.esc(extra)}</span>`:''}</p><h1 id="sceneTitle">${ctx.esc(ctx.source.title)}</h1></header>`;
  function gridCenters(weights) {
    const gap=2000/92,total=weights.reduce((sum,value)=>sum+value,0),unit=(1000-gap*(weights.length-1))/total;
    let cursor=0;
    return weights.map(weight=>{const width=weight*unit,center=cursor+width/2;cursor+=width+gap;return center;});
  }
  function nodeCenters(ctx,wireSelector,nodeSelector,fallback) {
    const wire=ctx.root.querySelector(wireSelector),nodes=[...ctx.root.querySelectorAll(nodeSelector)];
    if(!wire?.getBoundingClientRect||nodes.length!==fallback.length)return fallback;
    const box=wire.getBoundingClientRect();
    if(!box.width)return fallback;
    return nodes.map((node,i)=>{if(!node.getBoundingClientRect)return fallback[i];const rect=node.getBoundingClientRect();return rect.width?1000*(rect.left+rect.width/2-box.left)/box.width:fallback[i];});
  }
  const info = () => '<button type="button" class="ex-context-button" data-ex-context aria-pressed="false" aria-label="Show the source reflection">i</button>';
  function bindContext(ctx) {
    ctx.root.querySelector('[data-ex-context]')?.addEventListener('click',()=>ctx.set({context:ctx.state.context?0:1}));
  }
  function paintContext(ctx,description,footer) {
    const panel=ctx.root.querySelector('[data-ex-description]');
    const context=!!ctx.state.context;
    if(panel){panel.textContent=context?footer:description;panel.classList.toggle('is-context',context);}
    const button=ctx.root.querySelector('[data-ex-context]');
    if(button){button.setAttribute('aria-pressed',String(context));button.setAttribute('aria-label',context?'Return to the selected connection':'Show the source reflection');}
  }
  const positions=[[65,120],[145,44],[275,62],[395,30],[520,78],[660,35],[815,58],[935,120],[815,194],[670,180],[490,205],[270,182]];
  const networkLayers={
    language:[[0,1],[2,3],[4,5],[6,7],[8,9],[10,11]],
    understanding:[[1,2],[3,4],[5,6],[7,8],[9,10],[11,0]],
    expectations:[[0,6],[2,8],[4,10]],
    experience:[[1,5],[5,9],[9,1],[3,7],[7,11],[11,3]]
  };
  const keys=Object.keys(networkLayers);
  entries[11]={
    defaults:{language:0,understanding:0,expectations:0,experience:0},
    ranges:{language:[0,1],understanding:[0,1],expectations:[0,1],experience:[0,1]},
    render(ctx){
      const t=ctx.source.texts;
      const equation=ctx.esc(t[2]).replace(/≠/g,'<span class="ex-not-equal">≠</span>');
      const links=keys.map(key=>`<g data-network-layer="${key}" class="ex-network-layer">${networkLayers[key].map(([a,b])=>`<line x1="${positions[a][0]}" y1="${positions[a][1]}" x2="${positions[b][0]}" y2="${positions[b][1]}"></line>`).join('')}</g>`).join('');
      const nodes=positions.map(([x,y],i)=>`<g data-participant="${i}" class="ex-participant"><circle class="ex-participant-halo" cx="${x}" cy="${y}" r="14"></circle><circle class="ex-participant-dot" cx="${x}" cy="${y}" r="6"></circle></g>`).join('');
      return `<section class="scene experiment ex-community" aria-labelledby="sceneTitle">${header(ctx)}<div class="ex-body"><p class="ex-community-equation">${equation}</p><div class="ex-network-field"><svg viewBox="0 0 1000 240" preserveAspectRatio="none" role="img" aria-label="Illustrative network. Toggle the shared foundations to add or remove different connections.">${links}${nodes}</svg></div><div class="ex-foundation-switches">${keys.map((key,i)=>`<button type="button" data-foundation="${key}" aria-pressed="false"><span class="ex-foundation-mark" aria-hidden="true">+</span><span>${ctx.esc(t[i+3])}</span></button>`).join('')}</div></div></section>`;
    },
    bind(ctx){ctx.root.querySelectorAll('[data-foundation]').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.foundation;ctx.set({[key]:ctx.state[key]?0:1});}));},
    paint(ctx){
      const connected=new Set();
      keys.forEach(key=>{
        const active=ctx.state[key]>=.5;
        const layer=ctx.root.querySelector(`[data-network-layer="${key}"]`);
        if(layer){layer.style.opacity=active?'1':'0';layer.classList.toggle('is-active',active);}
        const button=ctx.root.querySelector(`[data-foundation="${key}"]`);
        if(button){button.setAttribute('aria-pressed',String(active));button.querySelector('.ex-foundation-mark').textContent=active?'−':'+';}
        if(active)networkLayers[key].forEach(edge=>edge.forEach(node=>connected.add(node)));
      });
      ctx.root.querySelectorAll('[data-participant]').forEach(node=>node.classList.toggle('is-connected',connected.has(Number(node.dataset.participant))));
    }
  };
  const relationshipXs=gridCenters([.85,1.45,.8,1.4]);
  entries[13]={
    defaults:{link0:100,link1:100,link2:100,focus:0,context:0},
    ranges:{link0:[0,100],link1:[0,100],link2:[0,100],focus:[0,3],context:[0,1]},
    render(ctx){
      const stages=pairs(ctx.source);
      const names=stages.map((stage,i)=>`<button type="button" class="ex-relationship-node" data-stage="${i}" aria-pressed="${i===0}" aria-label="${ctx.esc(stage.name+': '+stage.description)}"><span>${ctx.esc(stage.name)}</span><i aria-hidden="true"></i></button>`).join('');
      const links=relationshipXs.slice(0,-1).map((x,i)=>`<g data-relationship-link="${i}"><line class="ex-link-guide" x1="${x}" y1="45" x2="${relationshipXs[i+1]}" y2="45"></line><line class="ex-link-live" data-link-live="${i}" x1="${x}" y1="45" x2="${relationshipXs[i+1]}" y2="45"></line><circle class="ex-link-end" data-link-end="${i}" cx="${relationshipXs[i+1]}" cy="45" r="7"></circle></g>`).join('');
      const nodes=relationshipXs.map((x,i)=>`<circle class="ex-chain-junction" data-junction="${i}" cx="${x}" cy="45" r="10"></circle>`).join('');
      const sliders=stages.slice(0,-1).map((stage,i)=>`<div class="ex-continuity-control"><button type="button" data-break="${i}" aria-label="Disconnect ${ctx.esc(stage.name)} from ${ctx.esc(stages[i+1].name)}"><span aria-hidden="true">↔</span></button><input type="range" min="0" max="100" step="1" value="100" data-continuity="${i}" aria-label="Connection from ${ctx.esc(stage.name)} to ${ctx.esc(stages[i+1].name)}"></div>`).join('');
      return `<section class="scene experiment ex-relationships" aria-labelledby="sceneTitle">${header(ctx,'ILLUSTRATIVE CONNECTIONS',true)}<div class="ex-body"><div class="ex-relationship-nodes">${names}</div><svg class="ex-relationship-wires" viewBox="0 0 1000 90" preserveAspectRatio="none" role="img" aria-label="Connections flow from honesty through vulnerability and trust to relationship.">${links}${nodes}</svg><div class="ex-continuity-controls">${sliders}</div><div class="ex-connection-inspection"><p data-ex-description>${ctx.esc(stages[0].description)}</p>${info()}</div></div></section>`;
    },
    bind(ctx){
      ctx.root.querySelectorAll('[data-stage]').forEach(button=>button.addEventListener('click',()=>ctx.set({focus:Number(button.dataset.stage),context:0})));
      ctx.root.querySelectorAll('[data-continuity]').forEach(input=>input.addEventListener('input',()=>ctx.set({['link'+input.dataset.continuity]:Number(input.value)})));
      ctx.root.querySelectorAll('[data-break]').forEach(button=>button.addEventListener('click',()=>{const key='link'+button.dataset.break;ctx.set({[key]:ctx.state[key]>0?0:100});}));
      bindContext(ctx);
    },
    paint(ctx){
      const stages=pairs(ctx.source),focus=Math.round(clamp(ctx.state.focus,0,3)),xs=nodeCenters(ctx,'.ex-relationship-wires','[data-stage]',relationshipXs);
      let reach=1;
      const first=ctx.root.querySelector('[data-junction="0"]');if(first){first.setAttribute('cx',String(xs[0]));first.style.opacity='1';first.classList.add('is-reached');}
      for(let i=0;i<3;i++){
        const value=clamp(ctx.state['link'+i],0,100),fraction=value/100;
        const end=xs[i]+(xs[i+1]-xs[i])*fraction;
        const line=ctx.root.querySelector(`[data-link-live="${i}"]`);
        const marker=ctx.root.querySelector(`[data-link-end="${i}"]`);
        const guide=ctx.root.querySelector(`[data-relationship-link="${i}"] .ex-link-guide`);
        if(guide){guide.setAttribute('x1',String(xs[i]));guide.setAttribute('x2',String(xs[i+1]));}
        if(line){line.setAttribute('x1',String(xs[i]));line.setAttribute('x2',String(end));line.style.opacity=String(reach);}
        if(marker){marker.setAttribute('cx',String(end));marker.style.opacity=String(reach);}
        reach*=fraction;
        const node=ctx.root.querySelector(`[data-junction="${i+1}"]`);
        if(node){node.setAttribute('cx',String(xs[i+1]));node.style.opacity=String(.18+.82*reach);node.classList.toggle('is-reached',reach>.95);}
        const input=ctx.root.querySelector(`[data-continuity="${i}"]`);
        if(input){input.value=String(value);input.style.setProperty('--connection',value+'%');input.setAttribute('aria-valuetext',value===0?'Disconnected':value===100?'Connected':'Partly connected');}
        const button=ctx.root.querySelector(`[data-break="${i}"]`);
        if(button){button.setAttribute('aria-pressed',String(value===0));button.setAttribute('aria-label',`${value===0?'Restore':'Disconnect'} ${stages[i].name} to ${stages[i+1].name}`);}
      }
      ctx.root.querySelectorAll('[data-stage]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.stage)===focus)));
      paintContext(ctx,stages[focus].description,ctx.source.texts.at(-1));
    }
  };
  const causalXs=gridCenters([.8,1.4,1,1.4,1.4,.75]);
  entries[17]={
    defaults:{story:100,focus:0,context:0},
    ranges:{story:[0,100],focus:[0,5],context:[0,1]},
    render(ctx){
      const stages=pairs(ctx.source);
      const names=stages.map((stage,i)=>`<button type="button" class="ex-causal-node" data-causal-stage="${i}" aria-pressed="${i===0}" aria-label="Trace from ${ctx.esc(stage.name)}. ${ctx.esc(stage.description)}"><span>${ctx.esc(stage.name)}</span><i aria-hidden="true"></i></button>`).join('');
      const lines=causalXs.slice(0,-1).map((x,i)=>`<g data-causal-link="${i}"><line class="ex-link-guide" x1="${x}" y1="45" x2="${causalXs[i+1]}" y2="45"></line><line class="ex-link-live" data-causal-live="${i}" x1="${x}" y1="45" x2="${causalXs[i+1]}" y2="45"></line><path class="ex-causal-arrow" d="M ${causalXs[i+1]-16} 37 L ${causalXs[i+1]-7} 45 L ${causalXs[i+1]-16} 53"></path></g>`).join('');
      const nodes=causalXs.map((x,i)=>`<circle class="ex-chain-junction" data-causal-junction="${i}" cx="${x}" cy="45" r="9"></circle>`).join('');
      return `<section class="scene experiment ex-causal" aria-labelledby="sceneTitle">${header(ctx,'ILLUSTRATIVE PATH')}<div class="ex-body"><div class="ex-causal-nodes">${names}</div><svg class="ex-causal-wires" viewBox="0 0 1000 90" preserveAspectRatio="none" role="img" aria-label="An illustrative path from event through meaning, belief, identity, behavior and life. Loosening the story connection leaves the event in place.">${lines}${nodes}</svg><div class="ex-story-link-control"><button type="button" data-release-story aria-label="Release the story connection" aria-pressed="false"><span>${ctx.esc(stages[1].name)}</span><i aria-hidden="true">↔</i></button><input type="range" min="0" max="100" step="1" value="100" data-story-link aria-label="Story connection"></div><div class="ex-connection-inspection"><p data-ex-description>${ctx.esc(stages[0].description)}</p>${info()}</div></div></section>`;
    },
    bind(ctx){
      ctx.root.querySelectorAll('[data-causal-stage]').forEach(button=>button.addEventListener('click',()=>ctx.set({focus:Number(button.dataset.causalStage),context:0})));
      ctx.root.querySelector('[data-story-link]')?.addEventListener('input',event=>ctx.set({story:Number(event.currentTarget.value)}));
      ctx.root.querySelector('[data-release-story]')?.addEventListener('click',()=>ctx.set({story:ctx.state.story>0?0:100}));
      bindContext(ctx);
    },
    paint(ctx){
      const stages=pairs(ctx.source),focus=Math.round(clamp(ctx.state.focus,0,5)),amount=clamp(ctx.state.story,0,100),fraction=amount/100,xs=nodeCenters(ctx,'.ex-causal-wires','[data-causal-stage]',causalXs);
      const first=ctx.root.querySelector('[data-causal-live="0"]');
      if(first){first.setAttribute('x1',String(xs[0]));first.setAttribute('x2',String(xs[0]+(xs[1]-xs[0])*fraction));}
      ctx.root.querySelectorAll('[data-causal-link]').forEach(group=>{
        const i=Number(group.dataset.causalLink);
        const guide=group.querySelector('.ex-link-guide'),line=group.querySelector('.ex-link-live'),arrow=group.querySelector('.ex-causal-arrow');
        if(guide){guide.setAttribute('x1',String(xs[i]));guide.setAttribute('x2',String(xs[i+1]));}
        if(line){line.setAttribute('x1',String(xs[i]));line.setAttribute('x2',String(i===0?xs[0]+(xs[1]-xs[0])*fraction:xs[i+1]));}
        if(arrow)arrow.setAttribute('d',`M ${xs[i+1]-16} 37 L ${xs[i+1]-7} 45 L ${xs[i+1]-16} 53`);
        group.classList.toggle('is-traced',i>=focus);
        group.style.setProperty('--path-presence',String(i===0?1:fraction*fraction));
        group.classList.toggle('is-loosened',fraction<.98);
      });
      ctx.root.querySelectorAll('[data-causal-junction]').forEach(node=>{
        const i=Number(node.dataset.causalJunction);
        node.setAttribute('cx',String(xs[i]));
        node.style.opacity=String(i===0?1:.17+.83*fraction*fraction);
        node.classList.toggle('is-reached',i===0||fraction>.98);
        node.classList.toggle('is-selected',i===focus);
      });
      ctx.root.querySelectorAll('[data-causal-stage]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.causalStage)===focus)));
      const input=ctx.root.querySelector('[data-story-link]');
      if(input){input.value=String(amount);input.style.setProperty('--connection',amount+'%');input.setAttribute('aria-valuetext',amount===0?'Story connection released; event unchanged':amount===100?'Story connection intact':'Story connection loosened');}
      const button=ctx.root.querySelector('[data-release-story]');
      if(button){button.setAttribute('aria-pressed',String(amount===0));button.setAttribute('aria-label',amount===0?'Restore the story connection':'Release the story connection');}
      paintContext(ctx,stages[focus].description,ctx.source.texts.at(-1));
    }
  };
})();
