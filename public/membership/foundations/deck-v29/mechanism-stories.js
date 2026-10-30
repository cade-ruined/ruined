(function () {
  'use strict';
  const experiments = window.FoundationExperiments ??= {};
  const cleanLines = value => String(value ?? '').split('\n').filter(Boolean);
  const sourceParts = ctx => {
    const t=ctx.source.texts, offset=ctx.n===24?1:0;
    return {kicker:t[0],title:t[1],intro:offset?t[2]:null,eventLabel:t[2+offset],event:t[3+offset],stories:cleanLines(t[4+offset])};
  };
  const heading = (ctx,kicker,title) => `<header class="ex-head ms-head${[19,20].includes(ctx.n)?' er-hidden-heading':''}"><p class="ms-overline${[24,27].includes(ctx.n)?' er-hidden-heading':''}">${ctx.esc(kicker)}</p><h1 id="sceneTitle">${ctx.esc(title)}</h1></header>`;
  const optionsDialog = (ctx,kind,items) => `<dialog class="ms-choice-dialog" data-ms-dialog="${kind}" aria-labelledby="${kind}ChoicesTitle${ctx.n}"><div class="ms-dialog-head"><h2 id="${kind}ChoicesTitle${ctx.n}">${kind==='story'?'CHOOSE A STORY':'CHOOSE A BELIEF'}</h2><button type="button" data-ms-close aria-label="Close choices">×</button></div><div class="ms-semantic-choices">${items.map((copy,i)=>`<button type="button" data-ms-choice="${i}" aria-pressed="${i===ctx.state.story}">${ctx.esc(copy)}</button>`).join('')}</div></dialog>`;
  const currentStory = (ctx,items) => items[Math.max(0,Math.min(items.length-1,Math.round(ctx.state.story||0)))];

  function bindDialogs(ctx,kind) {
    const dialog=ctx.root.querySelector(`[data-ms-dialog="${kind}"]`);
    const opener=ctx.root.querySelector('[data-ms-open]');
    opener.onclick=()=>dialog.showModal();
    dialog.querySelector('[data-ms-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>opener.focus({preventScroll:true}));
    dialog.querySelectorAll('[data-ms-choice]').forEach(button=>{
      button.onclick=()=>{ctx.set({story:Number(button.dataset.msChoice),...(kind==='story'?{weight:0}:{})});dialog.close();};
    });
  }

  function renderStory(ctx) {
    const s=sourceParts(ctx), chosen=currentStory(ctx,s.stories), weight=ctx.state.weight??0;
    const prompt=s.intro?`<button type="button" class="ms-text-control" data-ms-prompt-open aria-haspopup="dialog">PROMPT ↗</button>`:'';
    const promptDialog=s.intro?`<dialog class="ms-prompt-dialog" data-ms-prompt-dialog aria-labelledby="storyPromptTitle${ctx.n}"><div class="ms-dialog-head"><h2 id="storyPromptTitle${ctx.n}">THE PROMPT</h2><button type="button" data-ms-prompt-close aria-label="Close prompt">×</button></div><p>${ctx.esc(s.intro)}</p></dialog>`:'';
    return `<section class="scene experiment ms-story-experiment" aria-labelledby="sceneTitle" data-experiment="${ctx.n}">${heading(ctx,s.kicker,s.title)}<div class="ex-body ms-story-body" data-ms-body><div class="ms-fixed-event"><span>${ctx.esc(s.eventLabel)}</span><p>${ctx.esc(s.event)}</p></div><div class="ms-lens-canvas" data-ms-canvas data-no-swipe><p class="ms-event-backdrop" aria-hidden="true">${ctx.esc(s.event)}</p><div class="ms-story-lens" data-ms-lens${weight===0?' hidden':''}><p class="ms-story-quote" data-ms-quote>${ctx.esc(chosen)}</p></div><div class="ms-story-handle" data-ms-handle role="slider" tabindex="0" aria-label="Story influence. Drag left to bring in the story." aria-valuemin="0" aria-valuemax="100" aria-valuenow="${weight}" aria-valuetext="${weight} percent story influence"><span aria-hidden="true">↔</span></div></div><div class="ms-tools ${s.intro?'ms-tools-prompt':''}"><button type="button" class="ms-text-control" data-ms-open aria-haspopup="dialog">STORIES ↗</button>${prompt}<div class="ms-weight-control"><div class="ms-weight-labels" aria-hidden="true"><span>JUST THE EVENT</span><span>THE STORY</span></div><input data-ms-weight type="range" min="0" max="100" step="1" value="${weight}" aria-label="Story influence"></div><output data-ms-weight-label aria-label="Story influence">${weight}%</output><button type="button" class="ms-reset" data-ms-reset aria-label="Remove story influence while keeping this interpretation">↺</button></div></div>${optionsDialog(ctx,'story',s.stories)}${promptDialog}</section>`;
  }

  function paintStory(ctx) {
    const s=sourceParts(ctx),weight=Math.max(0,Math.min(100,ctx.state.weight??0)),story=currentStory(ctx,s.stories);
    ctx.root.querySelector('[data-ms-body]').style.setProperty('--lens-power',String(weight/100));
    const lens=ctx.root.querySelector('[data-ms-lens]');
    lens.hidden=weight===0;
    const handle=ctx.root.querySelector('[data-ms-handle]');
    handle.setAttribute('aria-valuenow',String(weight));
    const description=weight===0?`Just the event: ${s.event}`:`${weight} percent story influence: ${story}`;
    handle.setAttribute('aria-valuetext',description);
    ctx.root.querySelector('[data-ms-quote]').textContent=story;
    ctx.root.querySelector('[data-ms-weight]').value=String(weight);
    ctx.root.querySelector('[data-ms-weight]').setAttribute('aria-valuetext',description);
    ctx.root.querySelector('[data-ms-weight-label]').textContent=`${weight}%`;
    ctx.root.querySelectorAll('[data-ms-choice]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.msChoice)===ctx.state.story)));
  }

  function bindStory(ctx) {
    bindDialogs(ctx,'story');
    ctx.root.querySelector('[data-ms-weight]').oninput=event=>ctx.set({weight:Number(event.currentTarget.value)});
    ctx.root.querySelector('[data-ms-reset]').onclick=()=>ctx.set({weight:0});
    const prompt=ctx.root.querySelector('[data-ms-prompt-open]');
    if(prompt){
      const dialog=ctx.root.querySelector('[data-ms-prompt-dialog]');
      prompt.onclick=()=>dialog.showModal();
      dialog.querySelector('[data-ms-prompt-close]').onclick=()=>dialog.close();
      dialog.addEventListener('close',()=>prompt.focus({preventScroll:true}));
    }
    const canvas=ctx.root.querySelector('[data-ms-canvas]'),handle=ctx.root.querySelector('[data-ms-handle]');
    let drag=null;
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      const width=canvas.getBoundingClientRect().width;
      drag={pointer:event.pointerId,x:event.clientX,weight:ctx.state.weight,width};
      handle.focus({preventScroll:true});
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');
      event.preventDefault();
    });
    canvas.addEventListener('pointermove',event=>{
      if(!drag||drag.pointer!==event.pointerId)return;
      ctx.set({weight:Math.round(drag.weight+(drag.x-event.clientX)/drag.width*100)});
    });
    const stop=()=>{drag=null;canvas.classList.remove('is-dragging');};
    canvas.addEventListener('pointerup',stop);
    canvas.addEventListener('pointercancel',stop);
    canvas.addEventListener('lostpointercapture',stop);
    handle.addEventListener('keydown',event=>{
      let weight=ctx.state.weight;
      if(event.key==='ArrowRight'||event.key==='ArrowUp')weight+=5;
      else if(event.key==='ArrowLeft'||event.key==='ArrowDown')weight-=5;
      else if(event.key==='Home')weight=0;
      else if(event.key==='End')weight=100;
      else return;
      event.preventDefault();event.stopPropagation();ctx.set({weight});
    });
  }

  [19,20,24].forEach(number=>{
    experiments[number]={defaults:{story:0,weight:0},ranges:{story:[0,4],weight:[0,100]},render:renderStory,bind:bindStory,paint:paintStory};
  });

  function patternItems(ctx){return ctx.source.texts.slice(2);}
  function renderPatterns(ctx){
    const items=patternItems(ctx),story=currentStory(ctx,items),repeats=ctx.state.repeats??1;
    return `<section class="scene experiment ms-pattern-experiment" aria-labelledby="sceneTitle" data-experiment="27">${heading(ctx,ctx.source.texts[0],ctx.source.texts[1])}<div class="ex-body ms-pattern-body"><div class="ms-stamp-field" data-ms-stamp-field><div class="ms-footprints" aria-hidden="true">${Array.from({length:5},(_,i)=>`<p data-ms-stamp="${i}" class="ms-belief-stamp ms-belief-stamp-${i}"${i>=repeats-1?' hidden':''}>${ctx.esc(story)}</p>`).join('')}</div><p class="ms-primary-belief" data-ms-primary>${ctx.esc(story)}</p></div><div class="ms-tools"><button type="button" class="ms-text-control" data-ms-open aria-haspopup="dialog">BELIEFS ↗</button><input data-ms-repeats type="range" min="1" max="6" step="1" value="${repeats}" aria-label="Number of repetitions"><output data-ms-repeats-label aria-label="Number of repetitions">×${repeats}</output><button type="button" class="ms-reset" data-ms-pattern-reset aria-label="Clear repeated footprints and keep the selected belief">↺</button></div></div>${optionsDialog(ctx,'belief',items)}</section>`;
  }
  function paintPatterns(ctx){
    const items=patternItems(ctx),story=currentStory(ctx,items),repeats=Math.max(1,Math.min(6,Math.round(ctx.state.repeats??1)));
    ctx.root.querySelector('[data-ms-primary]').textContent=story;
    ctx.root.querySelector('[data-ms-stamp-field]').style.setProperty('--repeat-count',String(repeats));
    ctx.root.querySelectorAll('[data-ms-stamp]').forEach(stamp=>{stamp.textContent=story;stamp.hidden=Number(stamp.dataset.msStamp)>=repeats-1;});
    ctx.root.querySelector('[data-ms-repeats]').value=String(repeats);
    ctx.root.querySelector('[data-ms-repeats-label]').textContent=`×${repeats}`;
    ctx.root.querySelectorAll('[data-ms-choice]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.msChoice)===ctx.state.story)));
  }
  function bindPatterns(ctx){
    bindDialogs(ctx,'belief');
    ctx.root.querySelector('[data-ms-repeats]').oninput=event=>ctx.set({repeats:Number(event.currentTarget.value)});
    ctx.root.querySelector('[data-ms-pattern-reset]').onclick=()=>ctx.set({repeats:1});
  }
  experiments[27]={defaults:{story:0,repeats:1},ranges:{story:[0,5],repeats:[1,6]},render:renderPatterns,bind:bindPatterns,paint:paintPatterns};
})();
